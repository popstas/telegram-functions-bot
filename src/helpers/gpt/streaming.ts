import OpenAI from "openai";
import { log } from "../../helpers.ts";
import { convertResponsesOutput } from "./responsesApi.ts";
import type { ConfigChatType } from "../../types.ts";

export async function handleResponseStream(
  stream: AsyncIterable<{ type: string; response?: unknown }> & {
    finalResponse(): Promise<OpenAI.Responses.Response>;
  },
  chatConfig?: ConfigChatType,
): Promise<{ res: OpenAI.ChatCompletion; webSearchDetails?: string }> {
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
        logLevel: "info",
      });
    }
  }

  const response = (await stream.finalResponse()) as OpenAI.Responses.Response;
  return convertResponsesOutput(response);
}
