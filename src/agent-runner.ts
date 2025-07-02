import { readConfig } from "./config.ts";
import { requestGptAnswer } from "./helpers/gpt/llm.ts";
import { ConfigChatType } from "./types.ts";
import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { addToHistory, forgetHistoryOnTimeout } from "./helpers/history.ts";
import { log } from "./helpers.ts";
import { agentNameToId } from "./helpers.ts";

export async function runAgent(
  agentName: string,
  text: string,
  progress?: (msg: string) => void,
): Promise<string> {
  const config = readConfig();
  const chat = config.chats.find((c) => c.agent_name === agentName);
  if (!chat) throw new Error(`Agent not found: ${agentName}`);
  const chatId = chat.id || parseInt("333" + agentNameToId(agentName));
  const msg: Message.TextMessage = {
    chat: { id: chatId, type: "private" as const, first_name: "cli" },
    text,
    message_id: Date.now(),
    date: Math.floor(Date.now() / 1000),
    from: { id: 0, is_bot: false, first_name: "cli", username: "cli" },
  };
  const ctx = {
    noSendTelegram: true,
    progressCallback: progress,
  } as unknown as Context;
  log({
    msg: msg.text,
    chatId,
    chatTitle: "cli",
    username: "cli",
    role: "user",
  });

  // Add user message to history before requesting answer
  addToHistory(msg, chat);
  forgetHistoryOnTimeout(chat, msg);

  const res = await requestGptAnswer(msg, chat as ConfigChatType, ctx);
  log({
    msg: res?.content || "",
    chatId,
    chatTitle: "cli",
    username: "cli",
    role: "assistant",
  });
  return res?.content || "";
}
