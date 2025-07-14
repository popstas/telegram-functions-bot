import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import OpenAI from "openai";
import type { Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types";

const mockEdit = jest.fn();
const mockDelete = jest.fn();
const mockUseBot = jest.fn(() => ({
  telegram: { editMessageText: mockEdit, deleteMessage: mockDelete },
}));

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: (...args: unknown[]) => mockUseBot(...args),
}));

jest.unstable_mockModule("../../src/utils/text.ts", () => ({
  splitBigMessage: (text: string) => [text],
}));

let convertResponsesOutput: typeof import("../../src/helpers/gpt/responsesApi").convertResponsesOutput;

beforeEach(async () => {
  jest.resetModules();
  mockEdit.mockReset();
  mockDelete.mockReset();
  const mod = await import("../../src/helpers/gpt/responsesApi");
  convertResponsesOutput = mod.convertResponsesOutput;
});

describe("convertResponsesOutput sentMessages", () => {
  it("edits and deletes sent messages", async () => {
    const r: OpenAI.Responses.Response = {
      output_text: "hi",
    } as OpenAI.Responses.Response;
    const sent = {
      chat: { id: 1, type: "private" },
      message_id: 42,
    } as Message.TextMessage;
    const chatConfig = { bot_token: "t" } as ConfigChatType;
    await convertResponsesOutput(r, { sentMessages: [sent], chatConfig });
    expect(mockEdit).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith(1, 42);
  });
});
