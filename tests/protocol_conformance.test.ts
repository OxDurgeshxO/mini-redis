import { test } from "node:test";
import assert from "node:assert";
import net from "net";
import { MiniRedisServer } from "../dist/server/tcp-server.js";
import { RespParser } from "../dist/protocol/resp/parser.js";
import { RespEncoder } from "../dist/protocol/resp/encoder.js";

const TEST_PORT = 6388;

test("Protocol Conformance Suite", async (t) => {
  const server = new MiniRedisServer({
    port: TEST_PORT,
    enableAof: false
  });
  await server.listen();

  const sendRaw = (payloads: Buffer[] | Buffer): Promise<Buffer> => {
    return new Promise((resolve, reject) => {
      const client = net.createConnection({ port: TEST_PORT }, () => {
        if (Array.isArray(payloads)) {
          for (const p of payloads) {
            client.write(p);
          }
        } else {
          client.write(payloads);
        }
      });

      let buf = Buffer.alloc(0);
      client.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        client.end();
      });

      client.on("end", () => resolve(buf));
      client.on("error", (err) => reject(err));
    });
  };

  await t.test("RESP2 data types round-trip", () => {
    // Simple String
    assert.strictEqual(RespEncoder.simpleString("PONG").toString(), "+PONG\r\n");
    // Integer
    assert.strictEqual(RespEncoder.integer(42).toString(), ":42\r\n");
    // Bulk String
    assert.strictEqual(RespEncoder.bulkString("foobar").toString(), "$6\r\nfoobar\r\n");
    // Null Bulk String
    assert.strictEqual(RespEncoder.null(2).toString(), "$-1\r\n");
    // Error
    assert.strictEqual(RespEncoder.error("syntax error").toString(), "-ERR syntax error\r\n");
    // Array
    assert.strictEqual(
      RespEncoder.array(["foo", "bar"], 2).toString(),
      "*2\r\n$3\r\nfoo\r\n$3\r\nbar\r\n"
    );
  });

  await t.test("Inline command processing", async () => {
    const res = await sendRaw(Buffer.from("PING\r\n"));
    assert.strictEqual(res.toString(), "+PONG\r\n");

    const setRes = await sendRaw(Buffer.from("SET inline:key inline:val\r\n"));
    assert.strictEqual(setRes.toString(), "+OK\r\n");

    const getRes = await sendRaw(Buffer.from("GET inline:key\r\n"));
    assert.strictEqual(getRes.toString(), "$10\r\ninline:val\r\n");
  });

  await t.test("Pipelining: multiple commands in single TCP frame", async () => {
    const pipeline = Buffer.concat([
      RespEncoder.commandToBuffer(["SET", "pipe:a", "1"]),
      RespEncoder.commandToBuffer(["INCR", "pipe:a"]),
      RespEncoder.commandToBuffer(["GET", "pipe:a"])
    ]);

    const res = await sendRaw(pipeline);
    assert.strictEqual(res.toString(), "+OK\r\n:2\r\n$1\r\n2\r\n");
  });

  await t.test("Partial TCP frames: command split across packets", async () => {
    const fullCmd = RespEncoder.commandToBuffer(["SET", "split:key", "split:val"]);
    const half1 = fullCmd.subarray(0, 10);
    const half2 = fullCmd.subarray(10);

    return new Promise<void>((resolve, reject) => {
      const client = net.createConnection({ port: TEST_PORT }, () => {
        client.write(half1);
        setTimeout(() => {
          client.write(half2);
        }, 15);
      });

      client.on("data", (chunk) => {
        assert.strictEqual(chunk.toString(), "+OK\r\n");
        client.end();
        resolve();
      });

      client.on("error", reject);
    });
  });

  await t.test("Malformed commands return Redis-compatible error messages", async () => {
    const errRes = await sendRaw(RespEncoder.commandToBuffer(["SET"]));
    assert.strictEqual(
      errRes.toString(),
      "-ERR wrong number of arguments for 'set' command\r\n"
    );

    const unknownRes = await sendRaw(RespEncoder.commandToBuffer(["FOOBAR123"]));
    assert.strictEqual(unknownRes.toString(), "-ERR unknown command `FOOBAR123`\r\n");
  });

  await t.test("Concurrent client connections", async () => {
    const clients = 20;
    const promises: Promise<void>[] = [];

    for (let i = 0; i < clients; i++) {
      promises.push(
        (async () => {
          const key = `concurrent:${i}`;
          const val = `val_${i}`;
          const resSet = await sendRaw(RespEncoder.commandToBuffer(["SET", key, val]));
          assert.strictEqual(resSet.toString(), "+OK\r\n");
          const resGet = await sendRaw(RespEncoder.commandToBuffer(["GET", key]));
          assert.strictEqual(resGet.toString(), `$${val.length}\r\n${val}\r\n`);
        })()
      );
    }

    await Promise.all(promises);
  });

  await server.close();
});
