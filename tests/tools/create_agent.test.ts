import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type {
  ConfigChatType,
  ConfigType,
  ThreadStateType,
} from "../../src/types";

const mockReadConfig = jest.fn();
const mockWriteConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  __esModule: true,
  readConfig: () => mockReadConfig(),
  writeConfig: (...args: unknown[]) => mockWriteConfig(...args),
}));

let CreateAgentClient: typeof import("../../src/tools/create_agent.ts").CreateAgentClient;
let callFn: typeof import("../../src/tools/create_agent.ts").call;

beforeEach(async () => {
  jest.resetModules();
  mockReadConfig.mockReset();
  mockWriteConfig.mockReset();
  ({ CreateAgentClient, call: callFn } = await import(
    "../../src/tools/create_agent.ts"
  ));
});

describe("CreateAgentClient", () => {
  function baseConfig(): ConfigType {
    const parent = {
      name: "Parent",
      agent_name: "parent",
      completionParams: { model: "gpt" },
      chatParams: {},
      toolParams: {},
      tools: [],
    } as ConfigChatType;
    return {
      bot_name: "bot",
      auth: { bot_token: "", chatgpt_api_key: "" },
      privateUsers: [],
      local_models: [],
      http: {},
      chats: [parent],
    } as unknown as ConfigType;
  }

  it("creates agent and registers tool", async () => {
    const config = baseConfig();
    mockReadConfig.mockReturnValue(config);
    const client = new CreateAgentClient(config.chats[0], {
      id: 1,
      msgs: [],
      messages: [],
    } as ThreadStateType);

    const res = await client.create_agent({
      name: "My Agent",
      description: "desc",
      agent_name: "my_agent",
      prompt: "hello",
    });

    expect(res.content).toBe("Agent created: my_agent");
    expect(config.chats[1]).toMatchObject({
      agent_name: "my_agent",
      systemMessage: "hello",
    });
    expect(config.chats[0].tools?.[0]).toEqual({
      agent_name: "my_agent",
      name: "My Agent",
      description: "desc",
    });
    expect(mockWriteConfig).toHaveBeenCalledWith(undefined, config);
  });

  it("generates agent_name from name", async () => {
    const config = baseConfig();
    mockReadConfig.mockReturnValue(config);
    const client = new CreateAgentClient(config.chats[0], {
      id: 1,
      msgs: [],
      messages: [],
    } as ThreadStateType);

    await client.create_agent({ name: "Agent Name!" });

    expect(config.chats[1].agent_name).toBe("agent_name_");
  });

  it("call returns instance", () => {
    const inst = callFn(
      {
        agent_name: "parent",
        completionParams: { model: "gpt" },
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
      { id: 1, msgs: [], messages: [] } as ThreadStateType,
    );
    expect(inst).toBeInstanceOf(CreateAgentClient);
  });
});

export {};
