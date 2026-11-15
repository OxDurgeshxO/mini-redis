import { test } from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { RespParser } from "../dist/protocol/resp/parser.js";
import { RespEncoder } from "../dist/protocol/resp/encoder.js";
import { KeyValueStore } from "../dist/storage/memory-store.js";
import { CommandRouter } from "../dist/server/router.js";

test("Property-based Fuzzing Suite (fast-check)", async (t) => {
  await t.test("Fuzz: RespParser never crashes on arbitrary binary inputs", () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 0, maxLength: 1024 }), (bytes) => {
        const parser = new RespParser();
        const buf = Buffer.from(bytes);
        parser.append(buf);
        // Parsing should never throw unexpected error
        try {
          while (parser.parse() !== null) {
            // consume complete tokens
          }
        } catch (err: any) {
          assert.fail(`Parser threw on input: ${err.message}`);
        }
      }),
      { numRuns: 300 }
    );
  });

  await t.test("Fuzz: Bulk string round-trip invariant", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 256 }),
        (originalStr) => {
          const encoded = RespEncoder.commandToBuffer(["ECHO", originalStr]);
          const parser = new RespParser();
          parser.append(encoded);
          const parsed = parser.parse();
          assert.notStrictEqual(parsed, null);
          assert.strictEqual(parsed![0], "ECHO");
          assert.strictEqual(parsed![1], originalStr);
        }
      ),
      { numRuns: 200 }
    );
  });

  await t.test("Fuzz: CommandRouter never crashes on arbitrary command tokens", () => {
    const store = new KeyValueStore();
    const router = new CommandRouter(store);

    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }),
        (args) => {
          try {
            const { response } = router.dispatch(args, 2);
            assert(Buffer.isBuffer(response));
            assert(response.length > 0);
          } catch (err: any) {
            assert.fail(`Router threw uncaught exception on args [${args.join(", ")}]: ${err.message}`);
          }
        }
      ),
      { numRuns: 300 }
    );
  });

  await t.test("Fuzz: KeyValueStore state transitions", () => {
    const store = new KeyValueStore();

    fc.assert(
      fc.property(
        fc.commands([
          fc.tuple(fc.string({ minLength: 1, maxLength: 20 }), fc.string({ minLength: 0, maxLength: 50 })).map(
            ([k, v]) => ({
              check: () => true,
              run: () => {
                store.set(k, v);
                const fetched = store.get(k);
                assert.strictEqual(fetched, v);
              }
            })
          ),
          fc.string({ minLength: 1, maxLength: 20 }).map((k) => ({
            check: () => true,
            run: () => {
              store.delete(k);
              assert.strictEqual(store.get(k), null);
            }
          }))
        ]),
        (cmds) => {
          const s = () => ({});
          fc.modelRun(s, cmds);
        }
      ),
      { numRuns: 100 }
    );
  });
});
