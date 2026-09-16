import { jest, describe, it, expect, beforeEach, beforeAll } from "@jest/globals";
import type { Message } from "grammy/types";
import type { BotContext } from "../../src/telegram/botContext.ts";

const mockTranscribe = jest.fn();

jest.unstable_mockModule("../../src/handlers/onAudio.ts", () => ({
  __esModule: true,
  default: jest.fn(),
  processAudio: jest.fn(),
  transcribe: (...args: unknown[]) => mockTranscribe(...args),
}));

jest.unstable_mockModule("../../src/helpers.ts", () => ({ log: jest.fn() }));

let requestAnswer: typeof import("../../src/handlers/relayAnswer.ts").requestAnswer;
let answerAfterRelay: typeof import("../../src/handlers/relayAnswer.ts").answerAfterRelay;

beforeAll(async () => {
  const mod = await import("../../src/handlers/relayAnswer.ts");
  requestAnswer = mod.requestAnswer;
  answerAfterRelay = mod.answerAfterRelay;
});

const CFG = { url: "http://runner/answer", token: "t", send_to: -5375745951, timeout: 5 };

function createCtx() {
  return { api: { sendMessage: jest.fn() } } as unknown as BotContext & {
    api: { sendMessage: jest.Mock };
  };
}

function textMsg(text: string): Message {
  return {
    message_id: 42,
    chat: { id: 111, type: "private" },
    from: { id: 7, is_bot: false, first_name: "Пётр", username: "manager" },
    date: 0,
    text,
  } as Message;
}

function mockFetchJson(body: unknown, ok = true) {
  global.fetch = jest.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

beforeEach(() => jest.clearAllMocks());

describe("requestAnswer", () => {
  it("возвращает текст ответа раннера", async () => {
    mockFetchJson({ answer: "Вот инструкция" });
    const out = await requestAnswer(CFG, { text: "вопрос", author: "manager", message_id: 42 });
    expect(out).toBe("Вот инструкция");
  });

  it("возвращает пустую строку при ошибке сети", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(await requestAnswer(CFG, { text: "q", author: "m", message_id: 1 })).toBe("");
  });

  it("возвращает пустую строку при не-200", async () => {
    mockFetchJson({ answer: "не должно уйти" }, false);
    expect(await requestAnswer(CFG, { text: "q", author: "m", message_id: 1 })).toBe("");
  });
});

describe("answerAfterRelay", () => {
  it("молчит на пустом ответе", async () => {
    mockFetchJson({ answer: "" });
    const ctx = createCtx();
    await answerAfterRelay(ctx, textMsg("сделал 12 звонков"), new Map([[-5375745951, 900]]), CFG);
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });

  it("отвечает в группу реплаем на копию сообщения", async () => {
    mockFetchJson({ answer: "Инструкция: У вас дорого - https://example/?key=146" });
    const ctx = createCtx();
    await answerAfterRelay(
      ctx,
      textMsg("что отвечать на дорого"),
      new Map([[-5375745951, 900]]),
      CFG,
    );
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      -5375745951,
      "Инструкция: У вас дорого - https://example/?key=146",
      { reply_parameters: { message_id: 900 } },
    );
  });

  it('при send_to "author" отвечает в личку реплаем на исходное сообщение', async () => {
    mockFetchJson({ answer: "ответ" });
    const ctx = createCtx();
    await answerAfterRelay(ctx, textMsg("вопрос"), new Map([[-5375745951, 900]]), {
      ...CFG,
      send_to: "author",
    });
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(111, "ответ", {
      reply_parameters: { message_id: 42 },
    });
  });

  it("в группе добавляет расшифровку голосового цитатой перед ответом", async () => {
    mockFetchJson({ answer: "ответ" });
    mockTranscribe.mockResolvedValue("что отвечать на дорого");
    const ctx = createCtx();
    const voice = {
      ...textMsg(""),
      text: undefined,
      voice: { file_id: "v1" },
    } as unknown as Message;
    await answerAfterRelay(ctx, voice, new Map([[-5375745951, 900]]), CFG);
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(
      -5375745951,
      "> что отвечать на дорого\n\nответ",
      { reply_parameters: { message_id: 900 } },
    );
  });

  it('при send_to "author" расшифровку не добавляет', async () => {
    mockFetchJson({ answer: "ответ" });
    mockTranscribe.mockResolvedValue("вопрос голосом");
    const ctx = createCtx();
    const voice = {
      ...textMsg(""),
      text: undefined,
      voice: { file_id: "v1" },
    } as unknown as Message;
    await answerAfterRelay(ctx, voice, new Map(), { ...CFG, send_to: "author" });
    expect(ctx.api.sendMessage).toHaveBeenCalledWith(111, "ответ", {
      reply_parameters: { message_id: 42 },
    });
  });

  it("рассылает ответ по списку целей: автору и в группу", async () => {
    mockFetchJson({ answer: "ответ" });
    const ctx = createCtx();
    await answerAfterRelay(ctx, textMsg("что отвечать на дорого"), new Map([[-5375745951, 900]]), {
      ...CFG,
      send_to: ["author", -5375745951],
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(2);
    expect(ctx.api.sendMessage).toHaveBeenNthCalledWith(1, 111, "ответ", {
      reply_parameters: { message_id: 42 },
    });
    expect(ctx.api.sendMessage).toHaveBeenNthCalledWith(2, -5375745951, "ответ", {
      reply_parameters: { message_id: 900 },
    });
  });

  it("в списке целей расшифровка добавляется только группе", async () => {
    mockFetchJson({ answer: "ответ" });
    mockTranscribe.mockResolvedValue("вопрос голосом");
    const ctx = createCtx();
    const voice = {
      ...textMsg(""),
      text: undefined,
      voice: { file_id: "v1" },
    } as unknown as Message;
    await answerAfterRelay(ctx, voice, new Map([[-5375745951, 900]]), {
      ...CFG,
      send_to: ["author", -5375745951],
    });
    expect(ctx.api.sendMessage).toHaveBeenNthCalledWith(1, 111, "ответ", {
      reply_parameters: { message_id: 42 },
    });
    expect(ctx.api.sendMessage).toHaveBeenNthCalledWith(
      2,
      -5375745951,
      "> вопрос голосом\n\nответ",
      {
        reply_parameters: { message_id: 900 },
      },
    );
  });

  it("сбой отправки в одну цель не отменяет вторую", async () => {
    mockFetchJson({ answer: "ответ" });
    const ctx = createCtx();
    ctx.api.sendMessage.mockRejectedValueOnce(new Error("chat not found"));
    await answerAfterRelay(ctx, textMsg("вопрос"), new Map([[-5375745951, 900]]), {
      ...CFG,
      send_to: ["author", -5375745951],
    });
    expect(ctx.api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("не зовёт раннер, когда текста нет", async () => {
    mockFetchJson({ answer: "не должно уйти" });
    mockTranscribe.mockResolvedValue("");
    const ctx = createCtx();
    const sticker = { ...textMsg(""), text: undefined } as unknown as Message;
    await answerAfterRelay(ctx, sticker, new Map(), CFG);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(ctx.api.sendMessage).not.toHaveBeenCalled();
  });
});
