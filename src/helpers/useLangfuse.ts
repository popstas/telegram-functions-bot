import { Langfuse, LangfuseTraceClient } from "langfuse";
import { useConfig } from "../config.ts";

let langfuse: Langfuse, trace: LangfuseTraceClient;

export default function useLangfuse(traceName?: string) {
  if (!langfuse) {
    const config = useConfig();
    langfuse = new Langfuse({
      secretKey: config.langfuse?.secretKey,
      publicKey: config.langfuse?.publicKey,
      baseUrl: config.langfuse?.baseUrl,
    });
  }
  trace = langfuse.trace({
    name: traceName || "telegram-functions-bot",
  });
  return {langfuse, trace};
}
