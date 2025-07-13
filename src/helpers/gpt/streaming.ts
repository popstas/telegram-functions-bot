import OpenAI from "openai";
import { log } from "../../helpers.ts";
import { convertResponsesOutput } from "./responsesApi.ts";
import type { ConfigChatType } from "../../types.ts";

export async function handleResponseStream(
  stream: AsyncIterable<{ type: string; response?: unknown }>,
  chatConfig?: ConfigChatType,
): Promise<{ res: OpenAI.ChatCompletion; webSearchDetails?: string }> {
  let completed: OpenAI.Responses.Response | undefined;
  for await (const event of stream) {
    log({
      msg: `responses event: ${event.type}`,
      chatId: chatConfig?.id,
      chatTitle: chatConfig?.name,
      logLevel: "debug",
    });
    if (event.type === "response.completed") {
      log({
        msg: `response.completed`,
        chatId: chatConfig?.id,
        chatTitle: chatConfig?.name,
        logLevel: "verbose",
      });
      completed = event.response as OpenAI.Responses.Response;
    }
  }

  if (!completed) {
    throw new Error("No response.completed event received");
  }

  return convertResponsesOutput(completed);
}
