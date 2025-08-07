import { Langfuse, LangfuseTraceClient } from "langfuse";
import { useConfig } from "../config.ts";
import { Message } from "telegraf/types";
import { ConfigChatType } from "../types.ts";

let langfuse: Langfuse;
const langfuses: Record<string, LangfuseTraceClient> = {};

export default function useLangfuse(msg: Message.TextMessage, chatConfig?: ConfigChatType) {
  const config = useConfig();
  if (!config.langfuse?.secretKey || !config.langfuse?.publicKey || !config.langfuse?.baseUrl) {
    return { langfuse: null, trace: null };
  }

  if (!langfuse) {
    langfuse = new Langfuse({
      secretKey: config.langfuse?.secretKey,
      publicKey: config.langfuse?.publicKey,
      baseUrl: config.langfuse?.baseUrl,
    });
  }
  const sessionId = getChatSessionName(msg, chatConfig);
  const name = `${sessionId} ${msg.message_id}`;
  if (!langfuses[name]) {
    const params = {
      name,
      sessionId,
      userId: msg.from?.username ?? "anon",
      input: msg.text,
    };
    langfuses[name] = langfuse.trace(params);
  }
  return { langfuse, trace: langfuses[name] };
}

// return [chat name] [username] [message id]
// "private [username]" for private chats
function getChatSessionName(msg: Message.TextMessage, chatConfig?: ConfigChatType) {
  const config = useConfig();
  const botName = chatConfig?.bot_name || config.bot_name;
  if (msg.chat.type === "private") return `${msg.from?.username} private ${botName} `;
  if (msg.chat.type === "group") return `group ${msg.chat.title}`;
  return `${msg.chat.type} ${msg.chat.title} ${msg.from?.username}`;
}
