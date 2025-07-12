import OpenAI from "openai";
import {
  replaceUrlPlaceholders,
  replaceToolPlaceholders,
} from "../placeholders.ts";
import express, { Response } from "express";
import { Context } from "telegraf";
import { Message } from "telegraf/types";
import {
  ConfigChatType,
  GptContextType,
  ToolResponse,
  ThreadStateType,
} from "../../types.ts";
import { addToHistory, forgetHistory } from "../history.ts";
import {
  sendTelegramMessage,
  sendTelegramDocument,
  getTelegramForwardedUser,
} from "../../telegram/send.ts";
import { useThreads } from "../../threads.ts";
import { useApi } from "../useApi.ts";
import useLangfuse from "../useLangfuse.ts";
import { observeOpenAI } from "langfuse";
import { useConfig } from "../../config.ts";
import { log } from "../../helpers.ts";
import { executeTools, resolveChatTools, getToolsPrompts } from "./tools.ts";
import { buildMessages, getSystemMessage } from "./messages.ts";
import { APIUserAbortError } from "openai";

export const EVALUATOR_PROMPT = `
You are an impartial quality auditor for a Telegram bot.
Your goal is to evaluate how complete and useful the assistant's answer ("Assistant answer") is in relation to the user's original request ("User request").

Rate completeness on a scale from 0 to 5. Return a single JSON object without additional text:

{
  "score": <integer 0-5>,
  "justification": "<one or two sentences describing what is missing or why the score is high>",
  "is_complete": <true|false>  # true if score >= 4
}
`;

export async function llmCall({
  apiParams,
  msg,
  chatConfig,
  generationName = "llm-call",
  localModel,
  signal,
}: {
  apiParams: OpenAI.Chat.Completions.ChatCompletionCreateParams;
  msg: Message.TextMessage;
  chatConfig?: ConfigChatType;
  generationName?: string;
  localModel?: string;
  signal?: AbortSignal;
}): Promise<{ res: OpenAI.ChatCompletion; trace?: unknown }> {
  const api = useApi(localModel || chatConfig?.local_model);
  const { trace } = chatConfig
    ? useLangfuse(msg, chatConfig)
    : { trace: undefined };
  let apiFunc = api;
  if (trace) {
    apiFunc = observeOpenAI(api, { generationName, parent: trace });
  }
  try {
    const useResponses = chatConfig?.chatParams?.useResponsesApi;
    const apiResponses = apiFunc as unknown as {
      responses?: {
        create: (
          params: Record<string, unknown>,
          options?: { signal?: AbortSignal },
        ) => Promise<{ output_text?: string }>;
      };
    };
    if (useResponses && apiResponses.responses?.create) {
      const respParams: Record<string, unknown> = {
        ...apiParams,
        input: (
          (apiParams as OpenAI.Chat.Completions.ChatCompletionCreateParams)
            .messages || []
        ).map((m: OpenAI.ChatCompletionMessageParam & { name?: string }) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { name: _unused, ...rest } = m;
          return rest;
        }),
      };
      delete (respParams as { messages?: unknown }).messages;
      if (apiParams.tools) {
        respParams.tools = (apiParams.tools as OpenAI.ChatCompletionTool[]).map(
          (t) => {
            if (t.type === "function") {
              const { function: fn, ...rest } = t;
              return {
                ...rest,
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
      const r = await apiResponses.responses.create(respParams, { signal });
      let res: OpenAI.ChatCompletion;
      if ((r as { output_text?: string }).output_text !== undefined) {
        const output = (r as { output_text?: string }).output_text ?? "";
        res = {
          choices: [{ message: { role: "assistant", content: output } }],
        } as OpenAI.ChatCompletion;
      } else if ((r as { type?: string }).type === "function_call") {
        const call = {
          id:
            (r as { call_id?: string; id?: string }).call_id ||
            (r as { id?: string }).id ||
            "call",
          type: "function",
          function: {
            name: (r as { name?: string }).name || "",
            arguments: (r as { arguments?: string }).arguments || "",
          },
        } as OpenAI.Chat.Completions.ChatCompletionMessageToolCall;
        res = {
          choices: [{ message: { role: "assistant", tool_calls: [call] } }],
        } as OpenAI.ChatCompletion;
      } else {
        const output = (r as { output?: string }).output ?? "";
        res = {
          choices: [{ message: { role: "assistant", content: output } }],
        } as OpenAI.ChatCompletion;
      }
      return { res, trace };
    } else {
      const res = (await apiFunc.chat.completions.create(apiParams, {
        signal,
      })) as OpenAI.ChatCompletion;
      return { res, trace };
    }
  } catch (e) {
    if (e instanceof APIUserAbortError) {
      return { res: {} as OpenAI.ChatCompletion, trace };
    }
    console.error("llmCall error", e);
    return { res: {} as OpenAI.ChatCompletion, trace };
  }
}

export type HandleModelAnswerParams = {
  msg: Message.TextMessage;
  res?: OpenAI.ChatCompletion;
  chatConfig: ConfigChatType;
  expressRes: express.Response | undefined;
  noSendTelegram?: boolean;
  gptContext: GptContextType;
  level?: number;
  trace?: unknown;
};

export type EvaluatorResult = {
  score: number;
  justification: string;
  is_complete: boolean;
};

async function evaluateAnswer(
  msg: Message.TextMessage,
  evaluator: ConfigChatType,
  task: string,
  answer: string,
): Promise<EvaluatorResult> {
  const systemMessage = [EVALUATOR_PROMPT, evaluator.systemMessage]
    .filter(Boolean)
    .join("\n\n");
  const userMessage = `User request:\n${task}\n\nAssistant answer:\n${answer}`;
  const apiParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    messages: [
      { role: "system", content: systemMessage },
      { role: "user", content: userMessage },
    ],
    model: evaluator.completionParams.model,
    temperature: evaluator.completionParams?.temperature,
    response_format: { type: "json_object" as const },
  };
  const { res } = await llmCall({
    apiParams,
    chatConfig: evaluator,
    generationName: "evaluation",
    localModel: evaluator.local_model,
    msg,
  });
  const content = res.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(content) as EvaluatorResult;
  } catch {
    return { score: 0, justification: "invalid json", is_complete: false };
  }
}

export type ProcessToolResultsParams = {
  tool_res: ToolResponse[];
  messageAgent: OpenAI.ChatCompletionMessage;
  chatConfig: ConfigChatType;
  msg: Message.TextMessage;
  expressRes: Response | undefined;
  noSendTelegram?: boolean;
  gptContext: GptContextType;
  level: number;
};

export async function handleModelAnswer({
  msg,
  res,
  chatConfig,
  expressRes,
  noSendTelegram,
  gptContext,
  level = 1,
  trace,
}: HandleModelAnswerParams): Promise<ToolResponse> {
  if (!res || !res?.choices?.[0]) {
    return { content: "" };
  }

  const messageAgent = res.choices[0].message;
  if (!messageAgent) {
    throw new Error("No message found in OpenAI response");
  }

  if (!messageAgent.tool_calls || messageAgent.tool_calls.length === 0) {
    const toolCallMatches = messageAgent.content?.matchAll(
      /<tool_call>([\s\S]*?)<\/tool_call>/g,
    );
    if (toolCallMatches) {
      const tool_calls =
        [] as OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
      for (const match of toolCallMatches) {
        try {
          const toolCallObj = JSON.parse(match[1]);
          tool_calls.push(toolCallObj);
        } catch {
          // ignore json errors
        }
      }
      if (tool_calls.length > 0) {
        messageAgent.tool_calls = tool_calls;
      }
    }
  }

  if (messageAgent.tool_calls?.length) {
    const tool_res = await executeTools(
      messageAgent.tool_calls,
      gptContext.chatTools,
      chatConfig,
      msg,
      expressRes,
      noSendTelegram,
    );
    if (tool_res) {
      return processToolResults({
        tool_res,
        messageAgent,
        chatConfig,
        msg,
        expressRes,
        noSendTelegram,
        gptContext,
        level,
      });
    }
  }

  const answer = res.choices[0]?.message.content || "";
  addToHistory(msg, chatConfig, answer);

  if (trace) {
    (trace as unknown as { update: (arg: unknown) => void }).update({
      output: answer,
    });
  }

  if (
    gptContext.thread.messages.find(
      (m: OpenAI.ChatCompletionMessageParam) => m.role === "tool",
    ) &&
    chatConfig.chatParams?.memoryless
  ) {
    forgetHistory(msg.chat.id);
  }

  return { content: answer };
}

function parseToolContent(content: string) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray((parsed as { content?: unknown }).content)) {
      return (parsed as { content: unknown[] }).content;
    }
  } catch {
    // ignore parse error
  }
  return [{ type: "text", text: content }];
}

export async function processToolResults({
  tool_res,
  messageAgent,
  chatConfig,
  msg,
  expressRes,
  noSendTelegram,
  gptContext,
  level,
}: ProcessToolResultsParams): Promise<ToolResponse> {
  gptContext.thread.messages.push(messageAgent);

  let isForget = false;
  let forgetMessage: string | undefined;

  for (let i = 0; i < tool_res.length; i++) {
    const toolRes = tool_res[i];
    const toolCall = (
      messageAgent as {
        tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
      }
    ).tool_calls[i];
    const chatTool = gptContext.chatTools.find(
      (f) => f.name === toolCall.function.name,
    );
    const isMcp = chatTool?.module.call(chatConfig, gptContext.thread).mcp;
    const showMessages =
      chatConfig.chatParams?.showToolMessages !== false && !isMcp;
    if (toolCall.function.name !== "forget") {
      const params = { deleteAfter: chatConfig.chatParams?.deleteToolAnswers };
      const toolResMessageLimit = 8000;
      const parts = parseToolContent(toolRes.content);
      for (const part of parts) {
        if (part.type === "text" && part.text && showMessages) {
          const msgContentLimited =
            part.text.length > toolResMessageLimit
              ? part.text.slice(0, toolResMessageLimit) + "..."
              : part.text;
          await sendTelegramMessage(
            msg.chat.id,
            msgContentLimited,
            params,
            undefined,
            chatConfig,
          );
        } else if (part.type === "resource") {
          if (part.resource?.blob) {
            const buffer = Buffer.from(part.resource.blob, "base64");
            await sendTelegramDocument(
              msg.chat.id,
              buffer,
              part.resource.name,
              part.resource.mimeType,
              chatConfig,
            );
          } else if (part.resource?.uri?.startsWith("file://")) {
            const filePath = part.resource.uri.replace(/^file:\/\//, "");
            await sendTelegramDocument(
              msg.chat.id,
              filePath,
              part.resource.name,
              part.resource.mimeType,
              chatConfig,
            );
          }
        }
      }
    }

    const messageTool: OpenAI.ChatCompletionToolMessageParam = {
      role: "tool",
      content: toolRes.content,
      tool_call_id: toolCall.id,
    };

    if (toolCall.function.name === "forget") {
      isForget = true;
      try {
        const args = JSON.parse(toolCall.function.arguments || "{}") as {
          message?: string;
        };
        if (args.message) {
          forgetMessage = args.message;
        }
      } catch {
        // ignore parse error
      }
      if (!forgetMessage) {
        forgetMessage = toolRes.content;
      }
    }

    gptContext.thread.messages.push(messageTool);
  }

  if (isForget) {
    forgetHistory(msg.chat.id);
    return { content: forgetMessage || "Forgot history, task completed." };
  }

  gptContext.messages = await buildMessages(
    gptContext.systemMessage,
    gptContext.thread.messages,
  );

  const isNoTool = level > 6 || !gptContext.tools?.length;

  const modelExternal = chatConfig.local_model
    ? useConfig().local_models.find((m) => m.name === chatConfig.local_model)
    : undefined;
  const model = modelExternal
    ? modelExternal.model
    : gptContext.thread.completionParams?.model || "gpt-4.1-mini";
  const apiParams = {
    messages: gptContext.messages,
    model,
    temperature: gptContext.thread.completionParams?.temperature,
    tools: isNoTool ? undefined : gptContext.tools,
    tool_choice: isNoTool
      ? undefined
      : ("auto" as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption),
  };

  const { res, trace } = await llmCall({
    apiParams,
    msg,
    chatConfig,
    generationName: "after-tools",
    localModel: chatConfig.local_model,
  });

  return await handleModelAnswer({
    msg,
    res,
    chatConfig,
    expressRes,
    noSendTelegram,
    gptContext,
    level: level + 1,
    trace,
  });
}

export async function requestGptAnswer(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
  ctx?: Context & {
    expressRes?: express.Response;
    progressCallback?: (msg: string) => void;
    noSendTelegram?: boolean;
  },
  options?: {
    skipEvaluators?: boolean;
    responseFormat?: OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"];
    signal?: AbortSignal;
  },
) {
  if (!msg.text) return;
  const threads = useThreads();

  const forwardedName = getTelegramForwardedUser(msg, chatConfig);
  if (forwardedName) {
    msg.text = `Переслано от: ${forwardedName}\n` + msg.text;
  }

  let thread = threads[msg.chat?.id || 0];

  if (!thread) {
    thread = threads[msg.chat?.id] = {
      id: msg.chat?.id,
      msgs: [],
      messages: [],
      completionParams: chatConfig.completionParams,
    } as ThreadStateType;
  }

  const chatTools = await resolveChatTools(msg, chatConfig);
  const prompts = await getToolsPrompts(chatTools, chatConfig, thread);

  const isTools = chatTools.length > 0;
  const tools = isTools
    ? ([
        ...chatTools
          .map((f) => f.module.call(chatConfig, thread).functions.toolSpecs)
          .flat(),
      ] as OpenAI.Chat.Completions.ChatCompletionTool[])
    : undefined;

  let systemMessage = await getSystemMessage(chatConfig, chatTools);
  const date = new Date().toISOString();
  systemMessage = systemMessage.replace(/\{date}/g, date);
  systemMessage = await replaceUrlPlaceholders(
    systemMessage,
    chatConfig.chatParams.placeholderCacheTime,
  );
  systemMessage = await replaceToolPlaceholders(
    systemMessage,
    chatTools,
    chatConfig,
    thread,
    chatConfig.chatParams.placeholderCacheTime,
  );
  if (thread.nextSystemMessage) {
    systemMessage = thread.nextSystemMessage || "";
    thread.nextSystemMessage = "";
  }

  const messages = await buildMessages(systemMessage, thread.messages);

  const modelExternal = chatConfig.local_model
    ? useConfig().local_models.find((m) => m.name === chatConfig.local_model)
    : undefined;
  const model = modelExternal
    ? modelExternal.model
    : thread.completionParams?.model || "gpt-4.1-mini";
  const apiParams = {
    messages,
    model,
    temperature: thread.completionParams?.temperature,
    tools,
    response_format: options?.responseFormat,
  };
  const { res, trace } = await llmCall({
    apiParams,
    msg,
    chatConfig,
    generationName: "llm-call",
    localModel: chatConfig.local_model,
    signal: options?.signal,
  });

  const gptContext: GptContextType = {
    thread,
    messages,
    systemMessage,
    chatTools,
    prompts,
    tools,
  };

  const result = await handleModelAnswer({
    msg,
    res,
    chatConfig,
    expressRes: ctx?.expressRes,
    noSendTelegram: ctx?.noSendTelegram,
    gptContext,
    trace,
  });

  if (!options?.skipEvaluators && chatConfig.evaluators?.length) {
    result.content = await runEvaluatorWorkflow(
      msg,
      chatConfig,
      result.content,
    );
  }

  return result;
}

async function runEvaluatorWorkflow(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
  answer: string,
): Promise<string> {
  const config = useConfig();
  let finalAnswer = answer;
  for (const ev of chatConfig.evaluators || []) {
    const evalChat = config.chats.find((c) => c.agent_name === ev.agent_name);
    if (!evalChat) continue;
    const threshold = ev.threshold ?? 4;
    const maxIter = ev.maxIterations ?? 2;
    let evaluation = await evaluateAnswer(
      msg,
      evalChat,
      msg.text || "",
      finalAnswer,
    );
    log({
      msg: `evaluation 1: ${JSON.stringify(evaluation)}`,
      chatId: evalChat.id,
      chatTitle: evalChat.name,
      username: "cli",
      role: "system",
    });
    let iter = 1;
    while (
      iter < maxIter + 1 &&
      (!evaluation.is_complete || evaluation.score < threshold)
    ) {
      iter++;
      const optimizeMsg: Message.TextMessage = {
        ...msg,
        text:
          msg.text +
          "\n\nAuditor comment: " +
          evaluation.justification +
          "\n\nFix the answer:",
      };
      const res = await requestGptAnswer(optimizeMsg, chatConfig, undefined, {
        skipEvaluators: true,
      });
      finalAnswer = res?.content || finalAnswer;
      evaluation = await evaluateAnswer(
        msg,
        evalChat,
        msg.text || "",
        finalAnswer,
      );
      log({
        msg: `evaluation ${iter}: ${JSON.stringify(evaluation)}`,
        chatId: evalChat.id,
        chatTitle: evalChat.name,
        username: "cli",
        role: "system",
      });
    }
  }
  return finalAnswer;
}
