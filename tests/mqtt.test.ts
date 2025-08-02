import { jest, describe, it, beforeEach, expect } from "@jest/globals";

const handlers: Record<string, (...args: unknown[]) => unknown> = {};
const mqttClient = {
  on: (event: string, fn: (...args: unknown[]) => unknown) => {
    handlers[event] = fn;
  },
  subscribe: jest.fn(),
  publish: jest.fn(),
};

const mockConnect = jest.fn(() => mqttClient);
const mockUseConfig = jest.fn();
const mockRunAgent = jest.fn();
const mockLog = jest.fn();

jest.unstable_mockModule("mqtt", () => ({
  default: { connect: (...args: unknown[]) => mockConnect(...args) },
}));

jest.unstable_mockModule("../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../src/agent-runner.ts", () => ({
  runAgent: (...args: unknown[]) => mockRunAgent(...args),
}));

jest.unstable_mockModule("../src/helpers.ts", () => ({
  log: (...args: unknown[]) => mockLog(...args),
  safeFilename: jest.fn(),
}));

let useMqtt: typeof import("../src/mqtt.ts").useMqtt;
let publishMqttProgress: typeof import("../src/mqtt.ts").publishMqttProgress;

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  for (const key of Object.keys(handlers)) delete handlers[key];
  ({ useMqtt, publishMqttProgress } = await import("../src/mqtt.ts"));
});

describe("useMqtt", () => {
  it("returns undefined when config missing", () => {
    mockUseConfig.mockReturnValue({});
    expect(useMqtt()).toBeUndefined();
  });

  it("connects and handles events", async () => {
    mockUseConfig.mockReturnValue({ mqtt: { base: "base" } });
    const client1 = useMqtt();
    const client2 = useMqtt();
    expect(client1).toBe(client2);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    handlers.connect();
    expect(mockLog).toHaveBeenCalledWith({
      msg: "mqtt connected",
      logPath: "data/mqtt.log",
    });
    expect(mqttClient.subscribe).toHaveBeenCalledWith("base/+");

    handlers.offline();
    expect(mockLog).toHaveBeenCalledWith({
      msg: "mqtt offline",
      logPath: "data/mqtt.log",
    });

    mockRunAgent.mockResolvedValue("answer");
    await handlers.message("base/agent", Buffer.from("hi"));
    expect(mockRunAgent).toHaveBeenCalledWith(
      "agent",
      "hi",
      expect.any(Function),
    );
    expect(mqttClient.publish).toHaveBeenCalledWith(
      "base/agent/answer",
      "answer",
    );
  });
});

describe("publishMqttProgress", () => {
  it("publishes progress when agent and config present", () => {
    mockUseConfig.mockReturnValue({ mqtt: { base: "base" } });
    useMqtt();
    publishMqttProgress("step", "agent");
    expect(mqttClient.publish).toHaveBeenCalledWith(
      "base/agent/progress",
      "step",
    );
  });
});
