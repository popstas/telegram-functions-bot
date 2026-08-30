import { describe, it, expect } from "@jest/globals";
import { mergeAgentDefaults } from "../src/config.ts";
import type { ConfigChatType } from "../src/types.ts";

const defaultChat = {
  name: "default",
  completionParams: { model: "gpt-5.6-luna", temperature: 0.5 },
  chatParams: { useResponsesApi: true, forgetTimeout: 900 },
  tools: ["javascript_interpreter"],
} as unknown as ConfigChatType;

function agent(overrides: Partial<ConfigChatType> = {}): ConfigChatType {
  return {
    name: "agent",
    agent_name: "leads",
    tools: ["planfix_search_lead_task"],
    ...overrides,
  } as ConfigChatType;
}

describe("mergeAgentDefaults", () => {
  it("inherits model and chatParams from the default chat", () => {
    const merged = mergeAgentDefaults(agent(), [defaultChat]);
    expect(merged.completionParams?.model).toBe("gpt-5.6-luna");
    expect(merged.chatParams?.useResponsesApi).toBe(true);
    expect(merged.chatParams?.forgetTimeout).toBe(900);
  });

  it("keeps the agent's own values over the default ones", () => {
    const merged = mergeAgentDefaults(
      agent({
        completionParams: { model: "gpt-5-nano" },
        chatParams: { useResponsesApi: false },
      } as Partial<ConfigChatType>),
      [defaultChat],
    );
    expect(merged.completionParams?.model).toBe("gpt-5-nano");
    expect(merged.chatParams?.useResponsesApi).toBe(false);
    // keys the agent does not set still come from default
    expect(merged.completionParams?.temperature).toBe(0.5);
    expect(merged.chatParams?.forgetTimeout).toBe(900);
  });

  it("never inherits tools, so an agent keeps exactly its own toolset", () => {
    const merged = mergeAgentDefaults(agent(), [defaultChat]);
    expect(merged.tools).toEqual(["planfix_search_lead_task"]);
  });

  it("returns the config untouched when there is no default chat", () => {
    const config = agent();
    expect(mergeAgentDefaults(config, [])).toBe(config);
  });

  it("returns the default chat itself untouched", () => {
    expect(mergeAgentDefaults(defaultChat, [defaultChat])).toBe(defaultChat);
  });
});
