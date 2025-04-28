import { Langfuse, LangfuseTraceClient } from "langfuse";
import { useConfig } from "../config.ts";

let langfuse: Langfuse;
const langfuses: Record<string, LangfuseTraceClient> = {};

export default function useLangfuse({
  name,
  sessionId,
  userId,
  input,
}: {
  name: string;
  sessionId: string;
  userId: string;
  input?: { text: string };
}) {
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
  name = name || "telegram-functions-bot";
  if (!langfuses[name]) {
    langfuses[name] = langfuse.trace({
      name,
      sessionId,
      userId,
      input,
    });
  }
  return { langfuse, trace: langfuses[name] };
}
