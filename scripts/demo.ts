import net from "node:net";
import fs from "node:fs";
import { MiniRedisServer } from "../dist/server.js";

const PORT = 6398;
const RDB_FILE = "./demo_dump.rdb";

if (fs.existsSync(RDB_FILE)) fs.unlinkSync(RDB_FILE);

const server = new MiniRedisServer(PORT, RDB_FILE);

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function encodeCommand(args: string[]): string {
  let out = `*${args.length}\r\n`;
  for (const arg of args) {
    const len = Buffer.byteLength(arg, "utf-8");
    out += `$${len}\r\n${arg}\r\n`;
  }
  return out;
}

function sendCommand(client: net.Socket, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    client.once("data", (data) => {
      resolve(data.toString("utf-8"));
    });
    client.write(encodeCommand(args));
  });
}

async function runDemo() {
  console.log("\x1b[36m========================================================\x1b[0m");
  console.log("\x1b[1m\x1b[32m       🚀 MINI-REDIS WIRE-COMPATIBLE LIVE DEMO         \x1b[0m");
  console.log("\x1b[36m========================================================\x1b[0m\n");

  server.listen(() => {
    console.log(`\x1b[33m[Server]\x1b[0m Listening on 127.0.0.1:${PORT} (RESP2 Protocol)`);
  });

  await sleep(150);

  const client = net.createConnection({ port: PORT, host: "127.0.0.1" }, async () => {
    console.log("\x1b[33m[Client]\x1b[0m Connected to MiniRedis TCP socket.\n");

    // 1. PING
    console.log("\x1b[34m>> redis-cli PING\x1b[0m");
    let res = await sendCommand(client, ["PING"]);
    console.log(`\x1b[32m<< ${res.trim()}\x1b[0m\n`);
    await sleep(250);

    // 2. SET with TTL
    console.log("\x1b[34m>> redis-cli SET user:oxdurgeshxo \"full-stack-engineer\" PX 1200\x1b[0m");
    res = await sendCommand(client, ["SET", "user:oxdurgeshxo", "full-stack-engineer", "PX", "1200"]);
    console.log(`\x1b[32m<< ${res.trim()}\x1b[0m\n`);
    await sleep(250);

    // 3. GET immediate
    console.log("\x1b[34m>> redis-cli GET user:oxdurgeshxo\x1b[0m");
    res = await sendCommand(client, ["GET", "user:oxdurgeshxo"]);
    console.log(`\x1b[32m<< ${res.trim()}\x1b[0m\n`);
    await sleep(250);

    // 4. SAVE snapshot
    console.log("\x1b[34m>> redis-cli SAVE (flushing binary RDB snapshot to disk)\x1b[0m");
    res = await sendCommand(client, ["SAVE"]);
    console.log(`\x1b[32m<< ${res.trim()}\x1b[0m\n`);
    await sleep(250);

    // 5. Wait for TTL expiry
    console.log("\x1b[35m[Engine]\x1b[0m Waiting 1300ms for TTL expiration...");
    await sleep(1300);

    // 6. GET expired
    console.log("\x1b[34m>> redis-cli GET user:oxdurgeshxo\x1b[0m");
    res = await sendCommand(client, ["GET", "user:oxdurgeshxo"]);
    console.log(`\x1b[31m<< ${res.trim()} (nil / expired)\x1b[0m\n`);

    console.log("\x1b[32m✔ Live demo executed cleanly. Shutting down.\x1b[0m");
    client.end();
    await server.close();
    if (fs.existsSync(RDB_FILE)) fs.unlinkSync(RDB_FILE);
    process.exit(0);
  });
}

runDemo().catch((err) => {
  console.error("Demo error:", err);
  process.exit(1);
});
