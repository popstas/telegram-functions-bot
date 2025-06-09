import mqtt from "mqtt";
import { useConfig } from "./config.ts";
import { runAgent } from "./agent-runner.ts";
import { log } from "./helpers.ts";
let client: mqtt.MqttClient | undefined;

export function useMqtt() {
  if (client) return client;
  const cfg = useConfig().mqtt;
  if (!cfg) return;
  client = mqtt.connect({
    host: cfg.host || "localhost",
    port: cfg.port || 1883,
    username: cfg.username,
    password: cfg.password,
  });
  client.on("connect", () => {
    log({ msg: "mqtt connected" });
    client?.subscribe(`${cfg.base}/+`);
  });
  client.on("offline", () => {
    log({ msg: "mqtt offline" });
  });
  client.on("message", async (topic, message) => {
    if (!client) return;
    const agent = topic.toString().replace(`${cfg.base}/`, "");
    const text = message.toString();
    const answer = await runAgent(agent, text, (msg) =>
      publishMqttProgress(msg, agent),
    );
    client.publish(`${cfg.base}/${agent}/answer`, answer);
  });
  return client;
}

export function publishMqttProgress(msg: string, agent?: string) {
  const cfg = useConfig().mqtt;
  if (!cfg) return;
  if (!agent) return;
  client?.publish(`${cfg.base}/${agent}/progress`, msg);
}
