import { MiniRedisServer } from "./server.js";

const PORT = parseInt(process.env.REDIS_PORT || "6379", 10);
const server = new MiniRedisServer(PORT);

server.listen(() => {
  console.log(`⚡ Mini-Redis wire-compatible server listening on port ${PORT}`);
  console.log(`Ready to accept connections from redis-cli or Redis client SDKs.`);
});
