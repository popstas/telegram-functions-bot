import OpenAI from "openai";

export function convertResponsesInput(
  apiParams: OpenAI.Chat.Completions.ChatCompletionCreateParams,
): Record<string, unknown> {
  const { messages, ...rest } = apiParams;
  const input: OpenAI.Responses.ResponseInputItem[] = [];
  for (const m of (messages || []) as (OpenAI.ChatCompletionMessageParam & {
    name?: string;
  })[]) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { name: _unused, ...msg } = m;
    if (
      msg.role === "assistant" &&
      (msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam)
        .tool_calls?.length
    ) {
      for (const call of (
        msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam
      ).tool_calls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]) {
        input.push({
          type: "function_call",
          name: call.function.name,
          arguments: call.function.arguments,
          call_id: call.id,
        } as OpenAI.Responses.ResponseFunctionToolCall);
      }
      if (
        (msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam)
          .content
      ) {
        input.push({
          role: "assistant",
          content: (
            msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam
          ).content as string,
          type: "message",
        } as OpenAI.Responses.EasyInputMessage);
      }
    } else if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: (msg as OpenAI.ChatCompletionToolMessageParam).tool_call_id,
        output: msg.content as string,
      } as OpenAI.Responses.ResponseInputItem.FunctionCallOutput);
    } else {
      input.push({
        role: msg.role as "user" | "assistant" | "system" | "developer",
        content: (msg as { content?: string }).content as string,
        type: "message",
      } as OpenAI.Responses.EasyInputMessage);
    }
  }
  const respParams: Record<string, unknown> = { ...rest, input };
  if (apiParams.tools) {
    respParams.tools = (apiParams.tools as OpenAI.ChatCompletionTool[]).map(
      (t) => {
        if (t.type === "function") {
          const { function: fn, ...toolRest } = t;
          return {
            ...toolRest,
            type: "function",
            name: fn.name,
            description: fn.description,
            parameters: fn.parameters,
          };
        }
        return t as unknown as Record<string, unknown>;
      },
    );
  }
  return respParams;
}

export function convertResponsesOutput(
  r: OpenAI.Responses.Response,
): OpenAI.ChatCompletion {
  const functionCalls = Array.isArray(r.output)
    ? (r.output.filter(
        (item) => item.type === "function_call",
      ) as OpenAI.Responses.ResponseFunctionToolCall[])
    : [];
  if (functionCalls.length) {
    const calls = functionCalls.map((call) => ({
      id: call.id ?? call.call_id,
      call_id: call.call_id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    return {
      choices: [{ message: { role: "assistant", tool_calls: calls } }],
    } as unknown as OpenAI.ChatCompletion;
  }
  const output = r.output_text ?? (r as { output?: string }).output ?? "";
  return {
    choices: [{ message: { role: "assistant", content: output } }],
  } as unknown as OpenAI.ChatCompletion;
}
