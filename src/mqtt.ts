import mqtt from "mqtt";
import { useConfig } from "./config.ts";
import { runAgent } from "./agent-runner.ts";
import { log } from "./helpers.ts";

const MQTT_LOG_PATH = "data/mqtt.log";
let client: mqtt.MqttClient | undefined;
let connected = false;

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
    connected = true;
    client?.subscribe(`${cfg.base}/+`);
  });
  client.on("offline", () => {
    log({ msg: "mqtt offline", logPath: MQTT_LOG_PATH });
    connected = false;
  });
  client.on("message", async (topic, message) => {
    if (!client) return;
    const agent = topic.toString().replace(`${cfg.base}/`, "");
    const text = message.toString();
    log({
      msg: text,
      chatTitle: "mqtt: " + agent,
      logPath: MQTT_LOG_PATH,
      username: "client",
    });
    const answer = await runAgent(agent, text, (msg) => publishMqttProgress(msg, agent));
    client.publish(`${cfg.base}/${agent}/answer`, answer);
    log({
      msg: answer,
      chatTitle: "mqtt: " + agent,
      logPath: MQTT_LOG_PATH,
      username: "mqtt",
    });
  });
  return client;
}

export function publishMqttProgress(msg: string, agent?: string) {
  const cfg = useConfig().mqtt;
  if (!cfg) return;
  if (!agent) return;
  client?.publish(`${cfg.base}/${agent}/progress`, msg);
}

export function isMqttConnected() {
  return connected;
}

export function shutdownMqtt() {
  if (!client) return;
  try {
    client.removeAllListeners();
    client.end(true);
  } catch (error) {
    log({ msg: `mqtt shutdown error: ${error}`, logPath: MQTT_LOG_PATH, logLevel: "warn" });
  }
  client = undefined;
  connected = false;
}
