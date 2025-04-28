import { Langfuse, LangfuseTraceClient } from "langfuse";
import { useConfig } from "../config.ts";
import {Message} from "telegraf/types";

let langfuse: Langfuse;
const langfuses: Record<string, LangfuseTraceClient> = {};

export default function useLangfuse(msg: Message.TextMessage) {
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
  const name = getChatTraceName(msg);
  if (!langfuses[name]) {
    const params = {
      name,
      sessionId: String(msg.chat.id),
      userId: msg.from?.username ?? "anon",
      input: msg.text,
    }
    langfuses[name] = langfuse.trace(params);
  }
  return { langfuse, trace: langfuses[name] };
}

// return [chat name] [username] [message id]
// "private [username]" for private chats
function getChatTraceName(msg: Message.TextMessage) {
  if (msg.chat.type === 'private') return `private ${msg.from?.username} ${msg.message_id}`
  if (msg.chat.type === 'group') return `${msg.chat.title} ${msg.from?.username} ${msg.message_id}`
  return `${msg.chat.title} ${msg.from?.username} ${msg.message_id}`
}
