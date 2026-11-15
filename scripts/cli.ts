import net from "net";
import readline from "readline";
import { RespEncoder } from "../src/protocol/resp/encoder.js";
import { RespParser } from "../src/protocol/resp/parser.js";

const PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const HOST = process.env.REDIS_HOST || "127.0.0.1";

console.log(`Connecting to mini-redis at ${HOST}:${PORT}...`);
const client = net.createConnection({ port: PORT, host: HOST });
const parser = new RespParser();

client.on("connect", () => {
  console.log(`Connected to mini-redis. Enter Redis commands (e.g. SET foo bar, GET foo, INFO). Type 'quit' to exit.\n`);
  promptUser();
});

client.on("data", (chunk: Buffer) => {
  parser.append(chunk);
  while (true) {
    const parsed = parser.parse();
    if (!parsed) break;
    console.log(JSON.stringify(parsed));
  }
  rl.prompt();
});

client.on("error", (err) => {
  console.error("Connection error:", err.message);
  process.exit(1);
});

client.on("close", () => {
  console.log("\nConnection closed.");
  process.exit(0);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: `${HOST}:${PORT}> `
});

function promptUser() {
  rl.prompt();
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "exit") {
      client.end();
      return;
    }
    if (trimmed.length > 0) {
      const parts = trimmed.split(/\s+/);
      client.write(RespEncoder.commandToBuffer(parts));
    } else {
      rl.prompt();
    }
  });
}
