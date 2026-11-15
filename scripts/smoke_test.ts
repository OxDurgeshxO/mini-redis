import net from "net";
import http from "http";
import { spawn } from "child_process";

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendCommand(client: net.Socket, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.once("data", (data) => resolve(data.toString()));
    client.once("error", reject);
    client.write(cmd);
  });
}

function fetchHttp(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
      res.on("error", reject);
    });
  });
}

async function runSmokeTest() {
  console.log("==> 1. Launching mini-redis server instance...");
  const serverProc = spawn("node", ["dist/index.js"], {
    env: { ...process.env, PORT: "6379", METRICS_PORT: "9121", AOF_ENABLED: "false" },
    stdio: "inherit"
  });

  await wait(1200);

  const client = new net.Socket();
  try {
    console.log("==> 2. Connecting raw TCP socket to :6379...");
    await new Promise<void>((resolve, reject) => {
      client.connect(6379, "127.0.0.1", () => resolve());
      client.on("error", reject);
    });

    console.log("==> 3. Testing PING...");
    let res = await sendCommand(client, "PING\r\n");
    console.log("Response:", JSON.stringify(res));
    if (!res.includes("+PONG")) throw new Error("PING failed");

    console.log("==> 4. Testing SET athlete:id 'usr_100' EX 30...");
    res = await sendCommand(client, "*5\r\n$3\r\nSET\r\n$10\r\nathlete:id\r\n$7\r\nusr_100\r\n$2\r\nEX\r\n$2\r\n30\r\n");
    console.log("Response:", JSON.stringify(res));
    if (!res.includes("+OK")) throw new Error("SET failed");

    console.log("==> 5. Testing GET athlete:id...");
    res = await sendCommand(client, "*2\r\n$3\r\nGET\r\n$10\r\nathlete:id\r\n");
    console.log("Response:", JSON.stringify(res));
    if (!res.includes("usr_100")) throw new Error("GET failed");

    console.log("==> 6. Testing HSET and HGETALL...");
    res = await sendCommand(client, "*4\r\n$4\r\nHSET\r\n$7\r\nathlete\r\n$4\r\nname\r\n$6\r\nmarcus\r\n");
    res = await sendCommand(client, "*2\r\n$7\r\nHGETALL\r\n$7\r\nathlete\r\n");
    console.log("HGETALL Response:", JSON.stringify(res));
    if (!res.includes("marcus")) throw new Error("HGETALL failed");

    console.log("==> 7. Testing Prometheus metrics :9121/metrics...");
    const metrics = await fetchHttp("http://127.0.0.1:9121/metrics");
    if (!metrics.includes("mini_redis_commands_total")) throw new Error("Prometheus metrics failed");
    console.log("Prometheus metrics OK. mini_redis_commands_total found.");

    console.log("==> 8. Testing Health probe :9121/healthz...");
    const health = await fetchHttp("http://127.0.0.1:9121/healthz");
    console.log("Healthz response:", health.trim());

    console.log("==> SMOKE TEST PASSED 100%!");
  } finally {
    client.destroy();
    serverProc.kill("SIGTERM");
  }
}

runSmokeTest().catch((err) => {
  console.error("SMOKE TEST FAILED:", err);
  process.exit(1);
});
