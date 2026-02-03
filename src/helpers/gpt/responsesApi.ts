import OpenAI from "openai";
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions";
import type { ResponsesParamsType } from "../../types.ts";

// Type guard for standard function tool calls (OpenAI v6 compatibility)
function isFunctionToolCall(
  toolCall: ChatCompletionMessageToolCall,
): toolCall is ChatCompletionMessageToolCall & { function: { name: string; arguments: string } } {
  return "function" in toolCall && toolCall.function !== undefined;
}

export function convertResponsesInput(
  apiParams: OpenAI.Chat.Completions.ChatCompletionCreateParams,
  responsesParams?: ResponsesParamsType,
): Record<string, unknown> {
  const { messages, response_format, ...rest } = apiParams;
  const input: OpenAI.Responses.ResponseInputItem[] = [];
  const instructionsParts: string[] = [];
  const seenInstructions = new Set<string>();
  const addInstruction = (role: string, name?: string) => {
    if (!name || role === "tool") return;
    const key = `${role}:${name}`;
    if (seenInstructions.has(key)) return;
    seenInstructions.add(key);
    instructionsParts.push(`${role} name: ${name}`);
  };
  for (const m of (messages || []) as (OpenAI.ChatCompletionMessageParam & {
    name?: string;
  })[]) {
    const { name, ...msg } = m;
    addInstruction(msg.role, name);
    if (
      msg.role === "assistant" &&
      (msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam).tool_calls?.length
    ) {
      for (const call of (msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam)
        .tool_calls as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]) {
        if (isFunctionToolCall(call)) {
          input.push({
            type: "function_call",
            name: call.function.name,
            arguments: call.function.arguments,
            call_id: call.id,
          } as OpenAI.Responses.ResponseFunctionToolCall);
        }
      }
      if ((msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam).content) {
        const assistantMessage = {
          role: "assistant",
          content: (msg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam)
            .content as string,
          type: "message",
        } as OpenAI.Responses.EasyInputMessage;
        input.push(assistantMessage);
      }
    } else if (msg.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: (msg as OpenAI.ChatCompletionToolMessageParam).tool_call_id,
        output: msg.content as string,
      } as OpenAI.Responses.ResponseInputItem.FunctionCallOutput);
    } else {
      const inputMessage = {
        role: msg.role as "user" | "assistant" | "system" | "developer",
        content: (msg as { content?: string }).content as string,
        type: "message",
      } as OpenAI.Responses.EasyInputMessage;
      input.push(inputMessage);
    }
  }
  const respParams: Record<string, unknown> = { ...rest, input };
  if (instructionsParts.length) {
    const namesInstruction = instructionsParts.join("\n");
    const existingInstructions =
      typeof respParams.instructions === "string" ? respParams.instructions : undefined;
    respParams.instructions = existingInstructions
      ? `${existingInstructions}\n${namesInstruction}`
      : namesInstruction;
  }
  if (responsesParams?.reasoning?.effort) {
    respParams.reasoning = { effort: responsesParams.reasoning.effort };
  }
  const textParams: Record<string, unknown> = {};
  if (responsesParams?.text?.verbosity) {
    textParams.verbosity = responsesParams.text.verbosity;
  }
  if (response_format) {
    if (response_format.type === "json_schema") {
      const json = response_format.json_schema || {};
      textParams.format = {
        type: "json_schema",
        name: json.name,
        schema: json.schema,
      };
    } else {
      textParams.format = response_format;
    }
  }
  if (Object.keys(textParams).length) {
    respParams.text = textParams;
  }
  if (apiParams.tools) {
    respParams.tools = (apiParams.tools as OpenAI.ChatCompletionTool[]).map((t) => {
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
    });
  }
  return respParams;
}

export function getWebSearchDetails(r: OpenAI.Responses.Response): string | undefined {
  if (!Array.isArray(r.output)) return undefined;

  type WebSearchCallItem = OpenAI.Responses.ResponseFunctionWebSearch & {
    action?:
      | OpenAI.Responses.ResponseFunctionWebSearch.Search
      | OpenAI.Responses.ResponseFunctionWebSearch.OpenPage;
  };

  const items = r.output.map(
    (raw) =>
      (typeof raw === "string" ? JSON.parse(raw) : raw) as
        | WebSearchCallItem
        | OpenAI.Responses.ResponseOutputMessage
        | Record<string, unknown>,
  );

  const opened = new Set<string>();
  for (const item of items) {
    if (item.type === "web_search_call") {
      const action = (item as WebSearchCallItem).action;
      if (action && action.type === "open_page") {
        const url = (action as OpenAI.Responses.ResponseFunctionWebSearch.OpenPage).url;
        if (url) opened.add(url);
      }
    }
  }

  const lines: string[] = [];
  let idx = 0;
  for (const item of items) {
    if (item.type === "web_search_call") {
      const action = (item as WebSearchCallItem).action;
      if (action && action.type === "search") {
        const query = (action as OpenAI.Responses.ResponseFunctionWebSearch.Search).query;
        idx++;
        lines.push(`${idx}. ${query}:`);
      }
    } else if (item.type === "message") {
      const msg = item as OpenAI.Responses.ResponseOutputMessage;
      const contentItem = msg.content.find((c) => c.type === "output_text") as
        | OpenAI.Responses.ResponseOutputText
        | undefined;
      const annotations = (contentItem?.annotations || []).filter(
        (a) => a.type === "url_citation",
      ) as OpenAI.Responses.ResponseOutputText.URLCitation[];
      for (const a of annotations) {
        const openedFlag = opened.has(a.url) ? " (opened)" : "";
        lines.push(`- [${a.title}](${a.url})${openedFlag}`);
      }
    }
  }

  return lines.length ? "`Web search:`\n\n" + lines.join("\n") : undefined;
}

export async function convertResponsesOutput(r: OpenAI.Responses.Response): Promise<{
  res: OpenAI.ChatCompletion;
  webSearchDetails?: string;
  images?: { id?: string; result: string }[];
}> {
  const functionCalls = Array.isArray(r.output)
    ? (
        r.output.filter(
          (item) => (typeof item === "string" ? JSON.parse(item) : item).type === "function_call",
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

  const webSearchDetails = getWebSearchDetails(r);

  const images: { id?: string; result: string }[] = [];
  if (Array.isArray(r.output)) {
    for (const raw of r.output) {
      const item = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (item.type === "image_generation_call" && item.result) {
        images.push({ id: item.id, result: item.result });
      }
    }
  }

  let output: string | undefined = r.output_text;
  if (!output && Array.isArray(r.output)) {
    const msgItem = r.output
      .map((item) => (typeof item === "string" ? JSON.parse(item) : item))
      .find((item) => item.type === "message") as
      | OpenAI.Responses.ResponseOutputMessage
      | undefined;
    if (msgItem) {
      const textItem = msgItem.content.find((c) => c.type === "output_text") as
        | OpenAI.Responses.ResponseOutputText
        | undefined;
      output = textItem?.text;
    }
  }

  const finalOutput = output ?? "";

  return {
    res: {
      choices: [{ message: { role: "assistant", content: finalOutput } }],
    } as unknown as OpenAI.ChatCompletion,
    webSearchDetails,
    images: images.length ? images : undefined,
  };
}
