import http from "http";
import { fileURLToPath } from "url";
import { resolve } from "path";

type HealthResponse = {
  botsRunning: boolean;
  mqttConnected: boolean;
};

export async function request(path: string): Promise<{
  statusCode: number;
  data: string;
}> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "localhost", port: process.env.PORT || 7586, path },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ statusCode: res.statusCode || 0, data }));
      },
    );
    req.on("error", () => resolve({ statusCode: 0, data: "" }));
  });
}

export const runHealthcheck = async () => {
  const ping = await request("/ping");
  if (ping.statusCode !== 200) {
    console.error("Ping failed");
    return false;
  }
  const health = await request("/health");
  if (health.statusCode !== 200) {
    console.error("Health endpoint unavailable");
    return false;
  }
  try {
    const { botsRunning, mqttConnected } = JSON.parse(
      health.data,
    ) as HealthResponse;
    if (!botsRunning || !mqttConnected) {
      console.error("Bots or MQTT unhealthy");
      return false;
    }
  } catch {
    console.error("Invalid health response");
    return false;
  }
  return true;
};

(async () => {
  const isMain = (() => {
    const currentFilePath = fileURLToPath(import.meta.url);
    const scriptPath = process.argv[1]
      ? resolve(process.cwd(), process.argv[1])
      : "";
    return scriptPath === currentFilePath;
  })();
  if (isMain) {
    const ok = await runHealthcheck();
    process.exit(ok ? 0 : 1);
  }
})();
