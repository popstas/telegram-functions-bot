import { describe, it, expect } from "@jest/globals";
import type { Message } from "grammy/types";
import { applyConfirmationOverride } from "../../src/helpers/gpt/toolConfirmation.ts";
import { ConfigChatType } from "../../src/types.ts";

const chatConfig: ConfigChatType = {
  name: "test",
  completionParams: {},
  toolParams: {},
} as ConfigChatType;

function makeMsg(text: string): Message.TextMessage {
  return { chat: { id: 1, type: "private" }, message_id: 1, text } as Message.TextMessage;
}

describe("applyConfirmationOverride", () => {
  it("sets confirmation false for noconfirm without throwing when chatParams is missing", () => {
    const msg = makeMsg("do it noconfirm");
    const res = applyConfirmationOverride(msg, chatConfig);
    expect(res.chatParams?.confirmation).toBe(false);
    expect(msg.text).toBe("do it ");
  });

  it("sets confirmation true for confirm without throwing when chatParams is missing", () => {
    const msg = makeMsg("do it confirm");
    const res = applyConfirmationOverride(msg, chatConfig);
    expect(res.chatParams?.confirmation).toBe(true);
    expect(msg.text).toBe("do it ");
  });

  it("returns chatConfig unchanged when neither keyword is present", () => {
    const msg = makeMsg("do it");
    const res = applyConfirmationOverride(msg, chatConfig);
    expect(res).toBe(chatConfig);
  });
});
