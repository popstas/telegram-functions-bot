import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const mockApiCreate = jest.fn();
const mockObserve = jest.fn();
const mockUseApi = jest.fn();
const mockUseLangfuse = jest.fn();

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.unstable_mockModule("../../src/helpers/useLangfuse.ts", () => ({
  default: () => mockUseLangfuse(),
}));

jest.unstable_mockModule("langfuse", () => ({
  observeOpenAI: (...args: unknown[]) => mockObserve(...args),
}));

let llmCall: typeof import("../../src/helpers/gpt/llm.ts").llmCall;

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockUseApi.mockReturnValue({
    chat: { completions: { create: mockApiCreate } },
  });
  mockUseLangfuse.mockReturnValue({ trace: {} });
  mockObserve.mockImplementation((api) => api);
  ({ llmCall } = await import("../../src/helpers/gpt/llm.ts"));
});

describe("llmCall", () => {
  it("calls API and returns result", async () => {
    mockApiCreate.mockResolvedValue({ id: 1 });
    const msg = { chat: { id: 1, type: "private" } } as Message.TextMessage;
    const chatConfig = {
      local_model: "m1",
      completionParams: {},
      chatParams: {},
      toolParams: {},
    } as unknown as ConfigChatType;
    const apiParams = { messages: [] } as any;
    const res = await llmCall({
      apiParams,
      msg,
      chatConfig,
      generationName: "gen",
      localModel: "m1",
    });
    expect(mockUseApi).toHaveBeenCalledWith("m1");
    expect(mockObserve).toHaveBeenCalled();
    expect(mockApiCreate).toHaveBeenCalledWith(apiParams);
    expect(res.res).toEqual({ id: 1 });
    expect(res.trace).toEqual({});
  });
});
