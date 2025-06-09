import OpenAI from "openai";
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
import { sendTelegramMessage, getTelegramForwardedUser } from "../telegram.ts";
import { useThreads } from "../../threads.ts";
import { useApi } from "../useApi.ts";
import useLangfuse from "../useLangfuse.ts";
import { observeOpenAI } from "langfuse";
import { useConfig } from "../../config.ts";
import { executeTools, resolveChatTools, getToolsPrompts } from "./tools.ts";
import { buildMessages, getSystemMessage } from "./messages.ts";

export type HandleModelAnswerParams = {
  msg: Message.TextMessage;
  res: OpenAI.ChatCompletion;
  chatConfig: ConfigChatType;
  expressRes: express.Response | undefined;
  noSendTelegram?: boolean;
  gptContext: GptContextType;
  level?: number;
  trace?: unknown;
};

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
  const messageAgent = res.choices[0]?.message;
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
  addToHistory({ msg, answer });

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
    if (showMessages && toolCall.function.name !== "forget") {
      const params = { deleteAfter: chatConfig.chatParams?.deleteToolAnswers };
      const toolResMessageLimit = 8000;
      const msgContentLimited =
        toolRes.content.length > toolResMessageLimit
          ? toolRes.content.slice(0, toolResMessageLimit) + "..."
          : toolRes.content;
      sendTelegramMessage(
        msg.chat.id,
        msgContentLimited,
        params,
        undefined,
        chatConfig,
      );
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

  const api = useApi(chatConfig.model);
  const modelExternal = chatConfig.model
    ? useConfig().models.find((m) => m.name === chatConfig.model)
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

  const { trace } = useLangfuse(msg, chatConfig);
  let apiFunc = api;
  if (trace) {
    apiFunc = observeOpenAI(api, {
      generationName: "after-tools",
      parent: trace,
    });
  }
  const res = await apiFunc.chat.completions.create(apiParams);

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
  if (thread.nextSystemMessage) {
    systemMessage = thread.nextSystemMessage || "";
    thread.nextSystemMessage = "";
  }

  const messages = await buildMessages(systemMessage, thread.messages);

  const api = useApi(chatConfig.model);
  const modelExternal = chatConfig.model
    ? useConfig().models.find((m) => m.name === chatConfig.model)
    : undefined;
  const model = modelExternal
    ? modelExternal.model
    : thread.completionParams?.model || "gpt-4.1-mini";
  const apiParams = {
    messages,
    model,
    temperature: thread.completionParams?.temperature,
    tools,
  };
  const { trace } = useLangfuse(msg, chatConfig);
  let apiFunc = api;
  if (trace) {
    apiFunc = observeOpenAI(api, { generationName: "llm-call", parent: trace });
  }
  const res = await apiFunc.chat.completions.create(apiParams);

  const gptContext: GptContextType = {
    thread,
    messages,
    systemMessage,
    chatTools,
    prompts,
    tools,
  };

  return await handleModelAnswer({
    msg,
    res,
    chatConfig,
    expressRes: ctx?.expressRes,
    noSendTelegram: ctx?.noSendTelegram,
    gptContext,
    trace,
  });
}
