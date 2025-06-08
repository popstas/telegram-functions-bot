import { readConfig } from "./config.ts";
import { requestGptAnswer } from "./helpers/gpt/llm.ts";
import { ConfigChatType } from "./types.ts";
import { Context } from "telegraf";
import { Message } from "telegraf/types";

export async function runAgent(
  agentName: string,
  text: string,
  progress?: (msg: string) => void,
): Promise<string> {
  const config = readConfig();
  const chat = config.chats.find((c) => c.agent_name === agentName);
  if (!chat) throw new Error(`Agent not found: ${agentName}`);
  const msg: Message.TextMessage = {
    chat: { id: 0, type: "private" as const, first_name: "cli" },
    text,
    message_id: Date.now(),
    date: Math.floor(Date.now() / 1000),
    from: { id: 0, is_bot: false, first_name: "cli" },
  };
  const ctx = {
    noSendTelegram: true,
    progressCallback: progress,
  } as unknown as Context;
  const res = await requestGptAnswer(msg, chat as ConfigChatType, ctx);
  return res?.content || "";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [agentName, ...t] = process.argv.slice(2);
  const text = t.join(" ");
  runAgent(agentName, text, (msg) => console.log(msg)).then((ans) =>
    console.log(ans),
  );
}
