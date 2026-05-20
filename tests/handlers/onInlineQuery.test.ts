import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { Context } from "telegraf";
import type { ConfigType } from "../../src/types.ts";

const mockUseConfig = jest.fn();
const mockRequestGptAnswer = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  __esModule: true,
  useConfig: (...args: unknown[]) => mockUseConfig(...args),
}));

jest.unstable_mockModule("../../src/helpers/gpt/llm.ts", () => ({
  __esModule: true,
  requestGptAnswer: (...args: unknown[]) => mockRequestGptAnswer(...args),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({
  __esModule: true,
  log: jest.fn(),
}));

let mod: typeof import("../../src/handlers/onInlineQuery.ts");

const baseConfig = (): ConfigType =>
  ({
    bot_name: "bot",
    chats: [
      {
        name: "default",
        systemMessage: "default system",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      },
    ],
    inlineMode: { buttons: [], live_answer: false, debounce_ms: 10 },
  }) as unknown as ConfigType;

beforeEach(async () => {
  jest.resetModules();
  jest.useRealTimers();
  mockUseConfig.mockReset();
  mockRequestGptAnswer.mockReset();
  mod = await import("../../src/handlers/onInlineQuery.ts");
  mod.__resetInlineState();
});

describe("getInlineButtons", () => {
  it("adds a default Ask button using default chat systemMessage", () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const buttons = mod.getInlineButtons();
    expect(buttons[0]).toEqual({ name: "Ask", prompt: "default system" });
  });

  it("keeps configured buttons and prepends Ask", () => {
    const config = baseConfig();
    config.inlineMode!.buttons = [{ name: "Summarize", prompt: "summarize this" }];
    mockUseConfig.mockReturnValue(config);
    const buttons = mod.getInlineButtons();
    expect(buttons.map((b) => b.name)).toEqual(["Ask", "Summarize"]);
  });

  it("does not duplicate an explicit Ask button", () => {
    const config = baseConfig();
    config.inlineMode!.buttons = [{ name: "Ask", prompt: "custom ask" }];
    mockUseConfig.mockReturnValue(config);
    const buttons = mod.getInlineButtons();
    expect(buttons).toEqual([{ name: "Ask", prompt: "custom ask" }]);
  });
});

describe("onInlineQuery", () => {
  it("returns one article per button", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const answerInlineQuery = jest.fn();
    const ctx = {
      inlineQuery: { query: "hello", from: { id: 5 } },
      answerInlineQuery,
    } as unknown as Context;

    await mod.onInlineQuery(ctx);

    expect(answerInlineQuery).toHaveBeenCalledTimes(1);
    const results = (answerInlineQuery as jest.Mock).mock.calls[0][0] as Array<{
      id: string;
      title: string;
    }>;
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("btn:0");
    expect(results[0].title).toBe("Ask");
  });

  it("does nothing when inlineMode is not configured", async () => {
    const config = baseConfig();
    delete config.inlineMode;
    mockUseConfig.mockReturnValue(config);
    const answerInlineQuery = jest.fn();
    const ctx = {
      inlineQuery: { query: "hi", from: { id: 1 } },
      answerInlineQuery,
    } as unknown as Context;

    await mod.onInlineQuery(ctx);
    expect(answerInlineQuery).not.toHaveBeenCalled();
  });

  it("does not add a live result when live_answer is off", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const answerInlineQuery = jest.fn();
    const ctx = {
      inlineQuery: { query: "hello", from: { id: 5 } },
      answerInlineQuery,
    } as unknown as Context;

    await mod.onInlineQuery(ctx);
    const results = (answerInlineQuery as jest.Mock).mock.calls[0][0] as Array<{ id: string }>;
    expect(results.some((r) => r.id === "live")).toBe(false);
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();
  });

  it("schedules a debounced live answer when live_answer is on", async () => {
    const config = baseConfig();
    config.inlineMode!.live_answer = true;
    config.inlineMode!.debounce_ms = 5;
    mockUseConfig.mockReturnValue(config);
    mockRequestGptAnswer.mockResolvedValue({ content: "live result" });

    const answerInlineQuery = jest.fn();
    const ctx = {
      inlineQuery: { query: "weather", from: { id: 7 } },
      answerInlineQuery,
    } as unknown as Context;

    await mod.onInlineQuery(ctx);
    // first call: no cached answer yet, schedules computation
    await new Promise((r) => setTimeout(r, 20));
    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);

    // second call with same query: cached answer surfaces as a live result
    await mod.onInlineQuery(ctx);
    const results = (answerInlineQuery as jest.Mock).mock.calls[1][0] as Array<{
      id: string;
      input_message_content: { message_text: string };
    }>;
    const live = results.find((r) => r.id === "live");
    expect(live).toBeDefined();
    expect(live!.input_message_content.message_text).toBe("live result");
  });
});

describe("computeInlineAnswer", () => {
  it("seeds the query into an isolated thread and cleans it up", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const threadsMod = await import("../../src/threads.ts");
    let seededMessages: unknown;
    let seededChatId: unknown;
    mockRequestGptAnswer.mockImplementation((...args: unknown[]) => {
      const m = args[0] as { chat: { id: number } };
      seededChatId = m.chat.id;
      seededMessages = threadsMod.useThreads()[m.chat.id]?.messages;
      return Promise.resolve({ content: "ok" });
    });

    const answer = await mod.computeInlineAnswer("a prompt", "my question", { id: 5 });

    expect(answer).toBe("ok");
    // The model must actually receive the typed query (it is read from
    // thread.messages, not msg.text).
    expect(seededMessages).toEqual([{ role: "user", content: "my question", name: "inline" }]);
    // The synthetic thread must not collide with the user's private DM id.
    expect(seededChatId).not.toBe(5);
    // The throwaway thread is removed after the run (no pollution / leak).
    expect(threadsMod.useThreads()[seededChatId as number]).toBeUndefined();
    expect(Object.keys(threadsMod.useThreads())).toHaveLength(0);
  });

  it("propagates the prompt as the chat systemMessage", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    let seenSystem: unknown;
    mockRequestGptAnswer.mockImplementation((...args: unknown[]) => {
      const chatConfig = args[1] as { systemMessage?: string };
      seenSystem = chatConfig.systemMessage;
      return Promise.resolve({ content: "ok" });
    });

    await mod.computeInlineAnswer("button prompt", "q", { id: 9 });
    expect(seenSystem).toBe("button prompt");
  });
});

describe("onChosenInlineResult", () => {
  it("runs the chosen button prompt and edits the message", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    mockRequestGptAnswer.mockResolvedValue({ content: "the answer" });
    const editMessageText = jest.fn();
    const ctx = {
      update: {
        chosen_inline_result: {
          result_id: "btn:0",
          query: "what is 2+2",
          inline_message_id: "abc123",
          from: { id: 9 },
        },
      },
      telegram: { editMessageText },
    } as unknown as Context;

    await mod.onChosenInlineResult(ctx);

    expect(mockRequestGptAnswer).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith(undefined, undefined, "abc123", "the answer");
  });

  it("ignores results without inline_message_id", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const editMessageText = jest.fn();
    const ctx = {
      update: {
        chosen_inline_result: {
          result_id: "btn:0",
          query: "x",
          from: { id: 9 },
        },
      },
      telegram: { editMessageText },
    } as unknown as Context;

    await mod.onChosenInlineResult(ctx);
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();
    expect(editMessageText).not.toHaveBeenCalled();
  });

  it("does not throw when the LLM call rejects", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    mockRequestGptAnswer.mockRejectedValue(new Error("boom"));
    const editMessageText = jest.fn();
    const ctx = {
      update: {
        chosen_inline_result: {
          result_id: "btn:0",
          query: "x",
          inline_message_id: "abc",
          from: { id: 9 },
        },
      },
      telegram: { editMessageText },
    } as unknown as Context;

    await expect(mod.onChosenInlineResult(ctx)).resolves.toBeUndefined();
    expect(editMessageText).not.toHaveBeenCalled();
  });

  it("ignores a malformed result_id", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const editMessageText = jest.fn();
    const ctx = {
      update: {
        chosen_inline_result: {
          result_id: "garbage",
          query: "x",
          inline_message_id: "abc",
          from: { id: 9 },
        },
      },
      telegram: { editMessageText },
    } as unknown as Context;

    await mod.onChosenInlineResult(ctx);
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();
    expect(editMessageText).not.toHaveBeenCalled();
  });

  it("ignores an out-of-range button index", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const editMessageText = jest.fn();
    const ctx = {
      update: {
        chosen_inline_result: {
          result_id: "btn:99",
          query: "x",
          inline_message_id: "abc",
          from: { id: 9 },
        },
      },
      telegram: { editMessageText },
    } as unknown as Context;

    await mod.onChosenInlineResult(ctx);
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();
    expect(editMessageText).not.toHaveBeenCalled();
  });

  it("ignores the live result id", async () => {
    mockUseConfig.mockReturnValue(baseConfig());
    const editMessageText = jest.fn();
    const ctx = {
      update: {
        chosen_inline_result: {
          result_id: "live",
          query: "x",
          inline_message_id: "abc",
          from: { id: 9 },
        },
      },
      telegram: { editMessageText },
    } as unknown as Context;

    await mod.onChosenInlineResult(ctx);
    expect(mockRequestGptAnswer).not.toHaveBeenCalled();
  });
});
