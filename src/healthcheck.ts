import http from "http";
import { fileURLToPath } from "url";
import { resolve } from "path";
import type express from "express";
import { useConfig } from "./config.ts";
import { getBots } from "./bot.ts";
import { isMqttConnected } from "./mqtt.ts";

export type HealthResponse = {
  healthy: boolean;
  errors: string[];
};

export function getHealthStatus() {
  const bots = getBots();
  const errors: string[] = [];

  const mqttConfig = useConfig().mqtt;
  if (mqttConfig && mqttConfig.host && !isMqttConnected()) {
    errors.push("MQTT is not connected");
  }

  Object.values(bots).forEach((bot) => {
    const polling = (
      bot as unknown as {
        polling?: { abortController: { signal: AbortSignal } };
      }
    ).polling;
    const isRunning = polling && !polling.abortController.signal.aborted;
    if (!isRunning) {
      errors.push(`Bot ${bot.botInfo?.username} is not running`);
    }
  });

  const healthy = errors.length === 0;
  return { healthy, errors } as HealthResponse;
}

export function healthHandler(_req: express.Request, res: express.Response) {
  res.json(getHealthStatus());
}

export async function request(path: string): Promise<{
  statusCode: number;
  data: string;
}> {
  return new Promise((resolve) => {
    const req = http.get({ host: "localhost", port: process.env.PORT || 7586, path }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, data }));
    });
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
    const { healthy, errors } = JSON.parse(health.data) as HealthResponse;
    if (!healthy) {
      console.error(errors.join("\n"));
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
    const scriptPath = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : "";
    return scriptPath === currentFilePath;
  })();
  if (isMain) {
    const ok = await runHealthcheck();
    process.exit(ok ? 0 : 1);
  }
})();
