import * as Express from "express";
import { Chat, Message } from "telegraf/types";
import OpenAI from "openai";
import {
  ChatToolType,
  ConfigChatType,
  ModuleType,
  ThreadStateType,
  ToolBotType,
  ToolResponse,
} from "../../types.ts";
import { useThreads } from "../../threads.ts";
import { sendTelegramMessage } from "../../telegram/send.ts";
import { log, sendToHttp, safeFilename } from "../../helpers.ts";
import useTools from "../useTools.ts";
import useLangfuse from "../useLangfuse.ts";
import { isAdminUser } from "../../telegram/send.ts";
import { useConfig } from "../../config.ts";
import { requestGptAnswer } from "./llm.ts";
import { includesUser } from "../../utils/users.ts";
import { publishMqttProgress } from "../../mqtt.ts";
import { telegramConfirm } from "../../telegram/confirm.ts";
import { applyConfirmationOverride } from "./toolConfirmation.ts";
import { applyToolHandler } from "./toolHandlers.ts";
import { formatToolParamsString, removeNullsParams } from "./toolFormatting.ts";

type ToolExecutionCancelMetadata = {
  cancelled: true;
  cancelMessages: string[];
};

export { prettifyKeyValue, removeNullsParams } from "./toolFormatting.ts";
export { sanitizeUrlForScreenshot, resolveScreenshotExtension } from "./toolScreenshot.ts";

export function chatAsTool({
  agent_name,
  bot_name,
  name,
  description,
  tool_use_behavior,
  prompt_append,
  msg,
}: ToolBotType & { msg: Message.TextMessage }): ChatToolType {
  name = safeFilename(name || agent_name || "", "agent");
  return {
    name,
    module: {
      description,
      call: (configChat: ConfigChatType, thread: ThreadStateType) => {
        const agentChatConfig = useConfig().chats.find(
          (c) => c.agent_name === agent_name || c.bot_name === bot_name,
        );
        if (!agentChatConfig) {
          throw new Error(`Agent not found: ${agent_name || bot_name || "unknown"}`);
        }
        return {
          agent: true,
          functions: {
            get: () => async (args: string) => {
              try {
                interface ParsedArgs {
                  input?: string;
                  text?: string;
                  [key: string]: unknown;
                }
                let parsedArgs: ParsedArgs;
                try {
                  parsedArgs = JSON.parse(args);
                } catch {
                  parsedArgs = { text: args };
                }
                msg.text =
                  typeof parsedArgs === "object" && parsedArgs !== null
                    ? parsedArgs.input || parsedArgs.text || args
                    : String(args);
                const agentStartMsg = `Получил ваше сообщение: ${msg.text}`;
                sendTelegramMessage(
                  msg.chat.id,
                  agentStartMsg,
                  undefined,
                  undefined,
                  agentChatConfig,
                );
                const res = await requestGptAnswer(msg, agentChatConfig);
                const answer = res?.content || "";
                sendTelegramMessage(msg.chat.id, answer, undefined, undefined, agentChatConfig);
                if (tool_use_behavior === "stop_on_first_tool") {
                  sendTelegramMessage(msg.chat.id, answer, undefined, undefined, configChat);
                  return { content: "" };
                }
                return { content: answer };
              } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                return {
                  content: `Proxy tool error for agent '${
                    agent_name || bot_name
                  }': ${errorMessage}`,
                };
              }
            },
            toolSpecs: {
              type: "function",
              function: {
                name,
                description: description || `Proxy tool for agent ${agent_name || bot_name}`,
                parameters: {
                  type: "object",
                  properties: {
                    input: {
                      type: "string",
                      description: "Input text for the tool (task, query, etc.)",
                    },
                  },
                  required: ["input"],
                },
              },
            },
          },
          async prompt_append() {
            return prompt_append;
          },
          configChat: agentChatConfig,
          thread,
        } as ModuleType;
      },
    },
  };
}

export async function executeTools(
  toolCalls: OpenAI.ChatCompletionMessageToolCall[],
  chatTools: ChatToolType[],
  chatConfig: ConfigChatType,
  msg: Message.TextMessage,
  expressRes?: Express.Response,
  noSendTelegram?: boolean,
): Promise<ToolResponse[]> {
  const thread = useThreads()[msg.chat.id || 0];
  chatConfig = applyConfirmationOverride(msg, chatConfig);
  const confirmationMessages: string[] = [];
  const cancellationPayloads: string[] = [];

  const toolPromises = toolCalls.map(async (toolCall) => {
    const chatTool = chatTools.find((f) => f.name === toolCall.function.name);
    if (!chatTool) return { content: `Tool not found: ${toolCall.function.name}` };

    const tool = chatTool.module.call(chatConfig, thread).functions.get(toolCall.function.name);
    if (!tool) return { content: `Tool not found! ${toolCall.function.name}` };

    let toolParams = toolCall.function.arguments;
    const toolClient = chatTool.module.call(chatConfig, thread);

    toolParams = removeNullsParams(toolParams);

    toolParams = applyToolHandler(toolCall.function.name, toolParams, {
      chatConfig,
      thread,
      toolCall,
    });

    const toolParamsStr = formatToolParamsString({
      toolCall,
      toolClient,
      toolParams,
    });

    confirmationMessages.push(toolParamsStr);
    try {
      const parsedForCancel = JSON.parse(toolParams);
      cancellationPayloads.push(
        JSON.stringify({ name: toolCall.function.name, arguments: parsedForCancel }),
      );
    } catch {
      cancellationPayloads.push(
        JSON.stringify({ name: toolCall.function.name, arguments: toolParams }),
      );
    }

    const chatTitle = (msg.chat as Chat.TitleChat).title;
    const chatId = msg.chat.id;
    const answerId = msg.message_id?.toString() || "";
    const showMessages = chatConfig.chatParams?.showToolMessages !== false;

    if (!chatConfig.chatParams?.confirmation && toolParams) {
      log({
        msg: `${toolCall.function.name}: ${toolParams}`,
        chatId,
        answerId,
        chatTitle,
        role: "assistant",
      });
      if (showMessages) {
        sendToHttp(expressRes, toolParamsStr);
        publishMqttProgress(toolParamsStr, chatConfig.agent_name);
        if (!noSendTelegram) {
          await sendTelegramMessage(
            chatId,
            toolParamsStr,
            { deleteAfter: chatConfig.chatParams?.deleteToolAnswers },
            undefined,
            chatConfig,
          );
        }
      }
    }

    if (!chatConfig.chatParams?.confirmation) {
      const { trace } = useLangfuse(msg, chatConfig);
      let span;
      if (trace) {
        span = trace.span({
          name: toolClient.agent
            ? `agent_call: ${toolCall.function.name}`
            : `tool_call: ${toolCall.function.name}`,
          metadata: { tool: toolCall.function.name },
          input: JSON.parse(toolParams),
        });
      }
      const executeToolInner = async (attempt = 0): Promise<ToolResponse> => {
        try {
          return (await tool(toolParams)) as ToolResponse;
        } catch (error: unknown) {
          const err = error as { status?: number; message?: string };
          if (err.status === 400 && err.message?.includes("Invalid parameter") && attempt === 0) {
            log({
              msg: `Retrying tool ${toolCall.function.name} after 400 error`,
              chatId: msg.chat.id,
              answerId,
              chatTitle: (msg.chat as Chat.TitleChat).title,
              role: "tool",
              logLevel: "warn",
            });
            return executeToolInner(attempt + 1);
          }
          throw error;
        }
      };

      const result = await executeToolInner();

      if (span) {
        span.end({ output: result.content });
      }
      try {
        const content = JSON.parse(result.content);
        log({
          msg: `${toolCall.function.name} result: ${content[0].text}`,
          chatId,
          answerId,
          chatTitle,
          role: "tool",
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        log({ msg: result.content, chatId, answerId, chatTitle, role: "tool" });
      }
      return result;
    }
    return { content: "" };
  });
  if (chatConfig.chatParams?.confirmation) {
    const confirmText = confirmationMessages.join("\n\n") + "\n\nDo you want to proceed?";
    sendToHttp(expressRes, confirmText);
    return telegramConfirm<ToolResponse[]>({
      chatId: msg.chat.id,
      msg,
      chatConfig,
      text: confirmText,
      noSendTelegram,
      onConfirm: async () => {
        const configConfirmed = JSON.parse(JSON.stringify(chatConfig));
        configConfirmed.chatParams.confirmation = false;
        const res = await executeTools(
          toolCalls,
          chatTools,
          configConfirmed,
          msg,
          expressRes,
          noSendTelegram,
        );
        const chatTitle = (msg.chat as Chat.TitleChat).title;
        const answerId = msg.message_id?.toString() || "";
        log({
          msg: "tools called",
          logLevel: "info",
          chatId: msg.chat.id,
          answerId,
          chatTitle,
          role: "tool",
        });
        return res;
      },
      onCancel: async () => {
        sendToHttp(expressRes, `Tool execution canceled`);
        if (!noSendTelegram) {
          await sendTelegramMessage(
            msg.chat.id,
            "Tool execution canceled.",
            undefined,
            undefined,
            chatConfig,
          );
        }
        const cancelResponse = [] as unknown as ToolResponse[] & ToolExecutionCancelMetadata;
        cancelResponse.cancelled = true;
        cancelResponse.cancelMessages = [...cancellationPayloads];
        return cancelResponse;
      },
    });
  }

  return Promise.all(toolPromises) as Promise<ToolResponse[]>;
}

export async function resolveChatTools(msg: Message.TextMessage, chatConfig: ConfigChatType) {
  if (msg.chat.type === "private" || isAdminUser(msg)) {
    if (!chatConfig.tools) chatConfig.tools = [];
    if (!chatConfig.tools.includes("change_chat_settings"))
      chatConfig.tools.push("change_chat_settings");
  }

  let agentTools: ChatToolType[] = [];
  if (chatConfig.tools) {
    if (chatConfig.tools.includes("change_access_settings") && !isAdminUser(msg)) {
      chatConfig.tools = chatConfig.tools.filter((t) => t !== "change_access_settings");
    }

    // build agent tools
    const agentsToolsConfigs = chatConfig.tools.filter((t) => {
      const isAgent = typeof t === "object" && ("agent_name" in t || "bot_name" in t);
      if (!isAgent) return false;
      const agentConfig = useConfig().chats.find(
        (c) =>
          c.agent_name === (t as ToolBotType).agent_name ||
          c.bot_name === (t as ToolBotType).bot_name,
      );
      if (!agentConfig) return false;
      if (agentConfig.privateUsers) {
        const isPrivateUser = includesUser(
          agentConfig.privateUsers,
          msg.from?.username || "without_username",
        );
        if (!isPrivateUser) return false;
      }
      return true;
    }) as ToolBotType[];
    agentTools = agentsToolsConfigs.map((t) => chatAsTool({ ...t, msg }));
  }

  const globalTools = await useTools();
  // Build effective tool names without persisting hidden ones to YAML
  const effectiveToolNames = new Set<string>();
  for (const t of chatConfig.tools ?? []) {
    if (typeof t === "string") effectiveToolNames.add(t);
  }
  // Include hidden memory tools when vector memory is enabled
  if (chatConfig.chatParams?.vector_memory) {
    effectiveToolNames.add("memory_add");
    effectiveToolNames.add("memory_search");
    effectiveToolNames.add("memory_delete");
  }

  const effectiveTools = Array.from(effectiveToolNames)
    .map((f) => globalTools.find((g) => g.name === f))
    .filter(Boolean) as ChatToolType[];

  return [...effectiveTools, ...agentTools].filter(Boolean);
}

export async function getToolsPrompts(
  chatTools: ChatToolType[],
  chatConfig: ConfigChatType,
  thread: ThreadStateType,
): Promise<string[]> {
  const promptsPromises = await Promise.all(
    chatTools
      .map(async (f) => {
        const module = f.module.call(chatConfig, thread);
        if (typeof module.prompt_append === "function") {
          return module.prompt_append();
        }
        return null;
      })
      .filter(Boolean),
  );
  return promptsPromises.filter(Boolean) as string[];
}

export async function getToolsSystemMessages(
  chatTools: ChatToolType[],
  chatConfig: ConfigChatType,
  thread: ThreadStateType,
) {
  const systemMessagesPromises = await Promise.all(
    chatTools
      .map(async (f) => {
        const module = f.module.call(chatConfig, thread);
        if (typeof module.systemMessage === "function") {
          return module.systemMessage();
        }
        return null;
      })
      .filter(Boolean),
  );
  return systemMessagesPromises.filter(Boolean) as string[];
}
