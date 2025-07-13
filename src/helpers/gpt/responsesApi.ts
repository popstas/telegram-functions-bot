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

export function convertResponsesOutput(r: OpenAI.Responses.Response): {
  res: OpenAI.ChatCompletion;
  webSearchDetails?: string;
} {
  const functionCalls = Array.isArray(r.output)
    ? (
        r.output.filter(
          (item) =>
            (typeof item === "string" ? JSON.parse(item) : item).type ===
            "function_call",
        ) as (OpenAI.Responses.ResponseFunctionToolCall | string)[]
      ).map((item) => (typeof item === "string" ? JSON.parse(item) : item))
    : [];
  if (functionCalls.length) {
    const calls = functionCalls.map((call) => ({
      id: call.id ?? call.call_id,
      call_id: call.call_id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    }));
    return {
      res: {
        choices: [{ message: { role: "assistant", tool_calls: calls } }],
      } as unknown as OpenAI.ChatCompletion,
    };
  }

  let webSearchDetails: string | undefined;
  if (Array.isArray(r.output)) {
    const lines: string[] = [];
    let idx = 0;
    for (const rawItem of r.output) {
      let item: any = rawItem;
      if (typeof rawItem === "string") {
        try {
          item = JSON.parse(rawItem);
        } catch {
          continue;
        }
      }
      if (item.type === "web_search_call") {
        idx++;
        const query = item.action?.query || item.action?.url || "";
        lines.push(`${idx}. ${query}:`);
      } else if (item.type === "message") {
        const contentItem = (item.content || []).find(
          (c: any) => c.type === "output_text",
        );
        const annotations = (contentItem?.annotations || []).filter(
          (a: any) => a.type === "url_citation",
        );
        for (const a of annotations) {
          lines.push(`- [${a.title}](${a.url})`);
        }
      }
    }
    if (lines.length) {
      webSearchDetails = "`Web search:`\n\n" + lines.join("\n");
    }
  }

  const output = r.output_text ?? "";
  return {
    res: {
      choices: [{ message: { role: "assistant", content: output } }],
    } as unknown as OpenAI.ChatCompletion,
    webSearchDetails,
  };
}
