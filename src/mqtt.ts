import mqtt from "mqtt";
import { useConfig } from "./config.ts";
import { runAgent } from "./agent-runner.ts";
import { log } from "./helpers.ts";

const MQTT_LOG_PATH = "data/mqtt.log";
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
    log({ msg: "mqtt connected", logPath: MQTT_LOG_PATH });
    client?.subscribe(`${cfg.base}/+`);
  });
  client.on("offline", () => {
    log({ msg: "mqtt offline", logPath: MQTT_LOG_PATH });
  });
  client.on("message", async (topic, message) => {
    if (!client) return;
    const agent = topic.toString().replace(`${cfg.base}/`, "");
    const text = message.toString();
    log({ msg: `[${agent}] ${text}`, logPath: MQTT_LOG_PATH });
    const answer = await runAgent(agent, text, (msg) =>
      publishMqttProgress(msg, agent),
    );
    client.publish(`${cfg.base}/${agent}/answer`, answer);
    log({ msg: `[${agent}] ${answer}`, logPath: MQTT_LOG_PATH });
  });
  return client;
}

export function publishMqttProgress(msg: string, agent?: string) {
  const cfg = useConfig().mqtt;
  if (!cfg) return;
  if (!agent) return;
  client?.publish(`${cfg.base}/${agent}/progress`, msg);
}
