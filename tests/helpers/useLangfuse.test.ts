import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Message } from "telegraf/types";

const mockTrace = jest.fn();
class MockLangfuse {
  options: unknown;
  constructor(opts: Record<string, unknown>) {
    this.options = opts;
  }
  trace(params: Record<string, unknown>) {
    mockTrace(params);
    return { name: params.name as string };
  }
}

const mockUseConfig = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
}));

jest.unstable_mockModule("langfuse", () => ({
  Langfuse: MockLangfuse,
  LangfuseTraceClient: class {},
}));

let useLangfuse: typeof import("../../src/helpers/useLangfuse.ts").default;

const baseMsg: Message.TextMessage = {
  message_id: 1,
  text: "hi",
  chat: { id: 1, type: "private", title: "" },
  from: { username: "user" },
} as Message.TextMessage;

describe("useLangfuse", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("returns null when config missing", async () => {
    mockUseConfig.mockReturnValue({ langfuse: {}, bot_name: "bot" });
    ({ default: useLangfuse } = await import(
      "../../src/helpers/useLangfuse.ts"
    ));
    const res = useLangfuse(baseMsg);
    expect(res).toEqual({ langfuse: null, trace: null });
  });

  it("creates trace when config present", async () => {
    mockUseConfig.mockReturnValue({
      langfuse: { secretKey: "s", publicKey: "p", baseUrl: "url" },
      bot_name: "bot",
    });
    ({ default: useLangfuse } = await import(
      "../../src/helpers/useLangfuse.ts"
    ));
    const res = useLangfuse(baseMsg);
    expect(res.langfuse).toBeInstanceOf(MockLangfuse);
    expect(res.trace).toEqual({ name: "user private bot  1" });
    expect(mockTrace).toHaveBeenCalled();
  });
});
