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

export function prettifyKeyValue(key: string, value: unknown, level = 0): string {
  function prettifyKey(innerKey?: string): string {
    if (!innerKey) return "";
    innerKey = innerKey.replace(/[_-]/g, " ");
    innerKey = innerKey.replace(/([a-z])([A-Z])/g, "$1 $2");
    innerKey = innerKey.charAt(0).toUpperCase() + innerKey.slice(1);
    return innerKey;
  }
  key = prettifyKey(key);
  const prefix = "  ".repeat(level) + "-";
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      if (value.length === 0) return `${prefix} *${key}:* (empty)`;
      return [
        `${prefix} *${key}:*`,
        ...value.map((v, i) => prettifyKeyValue(String(i), v, level + 1)),
      ].join("\n");
    }
    const entries = Object.entries(value);
    if (entries.length === 0) return `${prefix} *${key}:* (empty)`;
    return [
      `${prefix} *${key}:*`,
      ...entries.map(([k, v]) => prettifyKeyValue(k, v, level + 1)),
    ].join("\n");
  }
  return `${prefix} *${key}:* ${value}`;
}

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

  if (msg.text.includes("noconfirm")) {
    chatConfig = JSON.parse(JSON.stringify(chatConfig));
    chatConfig.chatParams.confirmation = false;
    msg.text = msg.text.replace("noconfirm", "");
  } else if (msg.text.includes("confirm")) {
    chatConfig = JSON.parse(JSON.stringify(chatConfig));
    chatConfig.chatParams.confirmation = true;
    msg.text = msg.text.replace("confirm", "");
  }
  const toolParamsList: string[] = [];

  const toolPromises = toolCalls.map(async (toolCall) => {
    const chatTool = chatTools.find((f) => f.name === toolCall.function.name);
    if (!chatTool) return { content: `Tool not found: ${toolCall.function.name}` };

    const tool = chatTool.module.call(chatConfig, thread).functions.get(toolCall.function.name);
    if (!tool) return { content: `Tool not found! ${toolCall.function.name}` };

    function joinWithOr(arr: string[]): string {
      if (arr.length === 0) return "";
      if (arr.length === 1) return arr[0];
      return arr.slice(0, -1).join(", ") + " or " + arr[arr.length - 1];
    }

    function prettifyKey(key?: string): string {
      if (!key) return "";
      key = key.replace(/[_-]/g, " ");
      key = key.replace(/([a-z])([A-Z])/g, "$1 $2");
      key = key.charAt(0).toUpperCase() + key.slice(1);
      return key;
    }

    interface FilterType {
      field?: string;
      operator?: string;
      value?: unknown;
    }

    interface SearchParams {
      filters?: FilterType[];
      query?: string;
      [key: string]: unknown;
    }

    function prettifyExpertizemeSearchItems(params: SearchParams, toolName: string): string {
      const title = toolName === "expertizeme_search_items" ? "Поиск СМИ:" : "Экспорт СМИ:";
      const lines: string[] = ["`" + title + "`"];
      if (Array.isArray(params.filters)) {
        for (const filter of params.filters) {
          if (typeof filter === "object" && filter !== null) {
            const field = prettifyKey(filter.field) || "";
            const operator = filter.operator || "";
            const value = filter.value;
            let valueStr = "";
            if (Array.isArray(value)) {
              valueStr = joinWithOr(value);
            } else {
              valueStr = value !== undefined ? String(value) : "";
            }
            const opStr = operator === "not" ? "not " : "";
            lines.push(`- **${field}**: ${opStr}${valueStr}`);
          }
        }
      }
      for (const [key, value] of Object.entries(params)) {
        if (["filters", "limit", "sortField", "sortDirection", "groupBy"].includes(key)) continue;
        if (Array.isArray(value)) {
          lines.push(`- **${prettifyKey(key)}**: ${joinWithOr(value)}`);
        } else {
          lines.push(`- **${prettifyKey(key)}**: ${value}`);
        }
      }
      if (params.sortField && typeof params.sortField === "string") {
        const sortLine =
          "- **Sort by** " +
          prettifyKey(params.sortField) +
          (params.sortDirection === "desc" ? " (descending)" : "");
        lines.push(sortLine);
      }
      if (params.groupBy && typeof params.groupBy === "string") {
        const groupByLine = "- **Group by** " + prettifyKey(params.groupBy);
        lines.push(groupByLine);
      }
      return lines.join("\n");
    }

    let toolParams = toolCall.function.arguments;
    const toolClient = chatTool.module.call(chatConfig, thread);

    toolParams = removeNullsParams(toolParams);

    if (toolCall.function.name === "planfix_add_to_lead_task") {
      const firstMessage = thread.msgs[0];
      const from = firstMessage.from;
      const fromUsername = from?.username || "";
      const msgs = thread.messages
        .filter((m) => ["user", "system"].includes(m.role))
        .map((m) => {
          const userMsg = m as OpenAI.ChatCompletionUserMessageParam;
          const name = userMsg.role === "user" ? userMsg.name : userMsg.role;
          return `${name}:\n${userMsg.content}`;
        })
        .join("\n\n");
      const toolParamsParsed = JSON.parse(toolParams) as {
        description: string;
      };
      if (!toolParamsParsed.description) toolParamsParsed.description = "";
      const fromStr = fromUsername ? `От ${fromUsername}` : "";
      toolParamsParsed.description += `\n\nПолный текст:\n${fromStr}\n\n${msgs}\n`;
      toolParams = JSON.stringify(toolParamsParsed);
    }

    let toolParamsStr: string;
    if (["expertizeme_search_items", "expertizeme_export_items"].includes(chatTool.name)) {
      toolParamsStr = prettifyExpertizemeSearchItems(JSON.parse(toolParams), chatTool.name);
    } else {
      toolParamsStr = [
        "`" +
          (toolClient.agent ? "Agent: " : "") +
          toolCall.function.name.replace(/[_-]/g, " ") +
          ":`",
        ...Object.entries(JSON.parse(toolParams)).map(([key, value]) =>
          prettifyKeyValue(key, value),
        ),
      ].join("\n");
    }
    if (typeof toolClient.options_string === "function") {
      toolParamsStr = toolClient.options_string(toolParams);
    }

    toolParamsList.push(toolParamsStr);

    const chatTitle = (msg.chat as Chat.TitleChat).title;
    const chatId = msg.chat.id;
    const showMessages = chatConfig.chatParams?.showToolMessages !== false;

    if (!chatConfig.chatParams?.confirmation && toolParams) {
      log({
        msg: `${toolCall.function.name}: ${toolParams}`,
        chatId,
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
          chatTitle,
          role: "tool",
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        log({ msg: result.content, chatId, chatTitle, role: "tool" });
      }
      return result;
    }
    return { content: "" };
  });
  if (chatConfig.chatParams?.confirmation) {
    const confirmText = toolParamsList.join("\n\n") + "\n\nDo you want to proceed?";
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
        log({
          msg: "tools called",
          logLevel: "info",
          chatId: msg.chat.id,
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
        return [];
      },
    });
  }

  return Promise.all(toolPromises) as Promise<ToolResponse[]>;
}

export function removeNullsParams(params: string): string {
  const filteredParams = Object.fromEntries(
    Object.entries(JSON.parse(params)).filter(([, value]) => value !== null),
  );
  return JSON.stringify(filteredParams);
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
  return [
    ...((chatConfig.tools ?? [])
      .map((f) => globalTools.find((g) => g.name === f))
      .filter(Boolean) as ChatToolType[]),
    ...agentTools,
  ].filter(Boolean);
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
