import mqtt from "mqtt";
import { useConfig } from "./config.ts";
import { runAgent } from "./cli-agent.ts";

let client: mqtt.MqttClient | undefined;

export function initMqtt() {
  const cfg = useConfig().mqtt;
  if (!cfg) return;
  client = mqtt.connect({
    host: cfg.host,
    port: cfg.port,
    username: cfg.user,
    password: cfg.password,
  });
  client.on("connect", () => {
    client?.subscribe(cfg.base + "+");
  });
  client.on("message", async (topic, message) => {
    if (!client) return;
    const agent = topic.toString().replace(cfg.base, "");
    const text = message.toString();
    const answer = await runAgent(agent, text, (msg) =>
      publishProgress(cfg.base + agent + "_progress", msg),
    );
    client.publish(cfg.base + agent + "_answer", answer);
  });
}

export function publishProgress(topic: string, msg: string) {
  client?.publish(topic, msg);
}
