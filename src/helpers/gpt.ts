import OpenAI from "openai";
import {
  ChatToolType,
  ConfigChatType,
  GptContextType,
  ToolResponse,
  ThreadStateType,
  ToolBotType,
  ModuleType,
} from "../types.ts";
import { useBot } from "../bot.ts";
import { useThreads } from "../threads.ts";
import { getEncoding, TiktokenEncoding } from "js-tiktoken";
import {
  sendTelegramMessage,
  getTelegramForwardedUser,
  getFullName,
} from "./telegram.ts";
import { Chat, Message } from "telegraf/types";
import { log, sendToHttp } from "../helpers.ts";
import { Context } from "telegraf";
import express, { Response } from "express";
import { addToHistory, forgetHistory } from "./history.ts";
import { isAdminUser } from "./telegram.ts";
import { useApi } from "./useApi.ts";
import useTools from "./useTools.ts";
import useLangfuse from "./useLangfuse.ts";
import { LangfuseTraceClient, observeOpenAI } from "langfuse";
import { useConfig } from "../config.ts";

/**
 * Creates a ChatToolType that proxies tool calls to another bot by bot_name.
 * The internal tool call will use the chat config of the target bot.
 */
export function chatAsTool({
  bot_name,
  name,
  description,
  tool_use_behavior,
  prompt_append,
  msg,
}: ToolBotType & { msg: Message.TextMessage }): ChatToolType {
  return {
    name,
    module: {
      description,
      call: (configChat: ConfigChatType, thread: ThreadStateType) => {
        // Find the chat config for the bot_name
        const agentChatConfig = useConfig().chats.find(
          (c) => c.bot_name === bot_name,
        );
        if (!agentChatConfig)
          throw new Error(`Bot with bot_name '${bot_name}' not found`);
        // Proxy to the target bot's tool call (assuming the bot is set up as a tool provider)
        // This assumes the target bot exposes a compatible tool interface
        // You may want to customize this logic for your specific bot integration
        return {
          agent: true,
          functions: {
            get: () => async (args: string) => {
              try {
                // Parse args as message text or object
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

                // Set the message text from parsed args or fallback to original args
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

                const res = await getChatgptAnswer(msg, agentChatConfig);
                const answer = res?.content || "";
                sendTelegramMessage(
                  msg.chat.id,
                  answer,
                  undefined,
                  undefined,
                  agentChatConfig,
                );
                if (tool_use_behavior === "stop_on_first_tool") {
                  // agent make final answer
                  sendTelegramMessage(
                    msg.chat.id,
                    answer,
                    undefined,
                    undefined,
                    configChat,
                  );
                  return { content: "" };
                }
                return { content: answer };
              } catch (err: unknown) {
                const errorMessage =
                  err instanceof Error ? err.message : String(err);
                return {
                  content: `Proxy tool error for bot '${bot_name}': ${errorMessage}`,
                };
              }
            },
            toolSpecs: {
              type: "function",
              function: {
                name,
                description: description || `Proxy tool for bot ${bot_name}`,
                parameters: {
                  type: "object",
                  properties: {
                    input: {
                      type: "string",
                      description:
                        "Input text for the tool (task, query, etc.)",
                    },
                  },
                  required: ["input"],
                },
              },
            },
          },
          prompt_append() {
            return prompt_append;
          },
          configChat: agentChatConfig,
          thread,
        } as ModuleType;
      },
    },
  };
}

type HandleGptAnswerParams = {
  msg: Message.TextMessage;
  res: OpenAI.ChatCompletion;
  chatConfig: ConfigChatType;
  expressRes: express.Response | undefined;
  gptContext: GptContextType;
  level?: number;
  trace?: LangfuseTraceClient | null;
};

type ProcessToolResponseParams = {
  tool_res: ToolResponse[];
  messageAgent: OpenAI.ChatCompletionMessage;
  chatConfig: ConfigChatType;
  msg: Message.TextMessage;
  expressRes: Response | undefined;
  gptContext: GptContextType;
  level: number;
};

export async function handleGptAnswer({
  msg,
  res,
  chatConfig,
  expressRes,
  gptContext,
  level = 1,
  trace,
}: HandleGptAnswerParams): Promise<ToolResponse> {
  const messageAgent = res.choices[0]?.message;
  if (!messageAgent) {
    throw new Error("No message found in OpenAI response");
  }

  // Extract legacy <tool_call> blocks if tool_calls is absent or empty
  if (!messageAgent.tool_calls || messageAgent.tool_calls.length === 0) {
    const toolCallMatches = messageAgent.content?.matchAll(
      /<tool_call>([\s\S]*?)<\/tool_call>/g,
    );
    if (toolCallMatches) {
      const tool_calls = [];
      for (const match of toolCallMatches) {
        try {
          const toolCallObj = JSON.parse(match[1]);
          tool_calls.push(toolCallObj);
        } catch {
          // Optionally handle JSON parse errors
        }
      }
      if (tool_calls.length > 0) {
        messageAgent.tool_calls = tool_calls;
      }
    }
  }

  if (messageAgent.tool_calls?.length) {
    const tool_res = await callTools(
      messageAgent.tool_calls,
      gptContext.chatTools,
      chatConfig,
      msg,
      expressRes,
    );
    if (tool_res) {
      return processToolResponse({
        tool_res,
        messageAgent,
        chatConfig,
        msg,
        expressRes,
        gptContext,
        level,
      });
    }
  }

  const answer = res.choices[0]?.message.content || "";
  addToHistory({ msg, answer });

  if (trace) {
    // trace.event({
    //   name: "message_sent",
    //   output:
    //   { text: answer },
    // });
    trace.update({
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

export async function processToolResponse({
  tool_res,
  messageAgent,
  chatConfig,
  msg,
  expressRes,
  gptContext,
  level,
}: ProcessToolResponseParams): Promise<ToolResponse> {
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
      const params = {
        /*parse_mode: 'MarkdownV2',*/ deleteAfter:
          chatConfig.chatParams?.deleteToolAnswers,
      };
      const toolResMessageLimit = 8000;
      const msgContentLimited =
        toolRes.content.length > toolResMessageLimit
          ? toolRes.content.slice(0, toolResMessageLimit) + "..."
          : toolRes.content;
      sendToHttp(expressRes, msgContentLimited);
      void sendTelegramMessage(
        msg.chat.id,
        msgContentLimited,
        params,
        undefined,
        chatConfig,
      );
    }

    const messageTool = {
      role: "tool",
      content: toolRes.content,
      tool_call_id: toolCall.id,
    } as OpenAI.ChatCompletionToolMessageParam;

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

  return await handleGptAnswer({
    msg,
    res,
    chatConfig,
    expressRes,
    gptContext,
    level: level + 1,
    trace,
  });
}

export async function getChatgptAnswer(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
  ctx?: Context & {
    expressRes?: express.Response;
  },
) {
  if (!msg.text) return;
  const threads = useThreads();

  // add "Forwarded from" to message
  const forwardedName = getTelegramForwardedUser(msg, chatConfig);
  if (forwardedName) {
    msg.text = `Переслано от: ${forwardedName}\n` + msg.text;
  }

  // begin answer, define thread
  let thread = threads[msg.chat?.id || 0];

  // add virtual thread for agentAsTool
  if (!thread) {
    // TODO: remove
    thread = threads[msg.chat?.id] = {
      id: msg.chat?.id,
      msgs: [],
      messages: [],
      completionParams: chatConfig.completionParams,
    };
  }

  const chatTools = await getChatTools(msg, chatConfig);

  // prompts from tools, should be after tools
  const prompts = await getToolsPrompts(chatTools, chatConfig, thread);

  const isTools = chatTools.length > 0;
  const tools = isTools
    ? ([
        ...chatTools
          .map((f) => f.module.call(chatConfig, thread).functions.toolSpecs)
          .flat(),
      ] as OpenAI.Chat.Completions.ChatCompletionTool[])
    : undefined;

  // systemMessage
  let systemMessage = await getSystemMessage(chatConfig, chatTools);
  const date = new Date().toISOString();
  systemMessage = systemMessage.replace(/\{date}/g, date);
  if (thread.nextSystemMessage) {
    systemMessage = thread.nextSystemMessage || "";
    thread.nextSystemMessage = "";
  }

  // messages
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
    // tool_choice: 'required',
    tools,
  };
  const { trace } = useLangfuse(msg, chatConfig);
  let apiFunc = api;
  if (trace) {
    apiFunc = observeOpenAI(api, {
      generationName: "llm-call",
      parent: trace,
    });
  }
  const res = await apiFunc.chat.completions.create(apiParams);
  /*const generation = trace.generation({
    name: 'chat-completion',
    model: apiParams.model,
    modelParameters: {
      temperature: apiParams.temperature,
    },
    input: apiParams.messages,
  });*/
  const gptContext: GptContextType = {
    thread,
    messages,
    systemMessage,
    chatTools,
    prompts,
    tools,
  };

  return await handleGptAnswer({
    msg,
    res,
    chatConfig,
    expressRes: ctx?.expressRes,
    gptContext,
    trace,
  });
}

export async function buildMessages(
  systemMessage: string,
  history: OpenAI.ChatCompletionMessageParam[],
) {
  const limit = 7; // TODO: to config
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemMessage,
    },
  ];

  // limit history
  history = history.slice(-limit);

  // remove role: tool message from history if is first message
  if (history.length && history[0].role === "tool") {
    history.shift();
  }

  messages.push(...history);

  return messages;
}

export async function getSystemMessage(
  chatConfig: ConfigChatType,
  chatTools: ChatToolType[],
): Promise<string> {
  const systemMessages = await getToolsSystemMessages(
    chatTools,
    chatConfig,
    {} as ThreadStateType,
  );
  const system =
    chatConfig.systemMessage ||
    systemMessages[0] ||
    "You are using functions to answer the questions. Current date: {date}";
  const prompts = await getToolsPrompts(
    chatTools,
    chatConfig,
    {} as ThreadStateType,
  );
  return system + (prompts.length ? `\n\n${prompts.join("\n\n")}` : "");
}

export function getTokensCount(chatConfig: ConfigChatType, text: string) {
  const encoding: TiktokenEncoding = chatConfig.completionParams.model.includes(
    "4o",
  )
    ? "o200k_base"
    : "cl100k_base";
  const tokenizer = getEncoding(encoding);
  return tokenizer.encode(text).length;
}

export async function callTools(
  toolCalls: OpenAI.ChatCompletionMessageToolCall[],
  chatTools: ChatToolType[],
  chatConfig: ConfigChatType,
  msg: Message.TextMessage,
  expressRes?: Express.Response,
): Promise<ToolResponse[]> {
  // toolCalls = groupToolCalls(toolCalls) // don't need to group anymore

  const thread = useThreads()[msg.chat.id || 0];

  // Check for 'confirm' or 'noconfirm' in the message to set confirmation
  if (msg.text.includes("noconfirm")) {
    chatConfig = JSON.parse(JSON.stringify(chatConfig));
    chatConfig.chatParams.confirmation = false;
    msg.text = msg.text.replace("noconfirm", "");
  } else if (msg.text.includes("confirm")) {
    chatConfig = JSON.parse(JSON.stringify(chatConfig));
    chatConfig.chatParams.confirmation = true;
    msg.text = msg.text.replace("confirm", "");
  }

  const uniqueId = Date.now().toString();

  const toolPromises = toolCalls.map(async (toolCall) => {
    const chatTool = chatTools.find((f) => f.name === toolCall.function.name);
    if (!chatTool)
      return { content: `Tool not found: ${toolCall.function.name}` };

    const tool = chatTool.module
      .call(chatConfig, thread)
      .functions.get(toolCall.function.name);
    if (!tool) return { content: `Tool not found! ${toolCall.function.name}` };

    function joinWithOr(arr: string[]): string {
      if (arr.length === 0) return "";
      if (arr.length === 1) return arr[0];
      return arr.slice(0, -1).join(", ") + " or " + arr[arr.length - 1];
    }

    function prettifyKey(key?: string): string {
      if (!key) return "";
      // replace _ or - with space
      key = key.replace(/[_-]/g, " ");
      // split camelCase
      key = key.replace(/([a-z])([A-Z])/g, "$1 $2");
      // uppercase first letter
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

    function prettifyExpertizemeSearchItems(params: SearchParams): string {
      const lines: string[] = ["`Поиск СМИ:`"];
      // Render filters first, as flat list
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
            // Special case: if operator is 'not', output 'not Value', else 'Value'
            const opStr = operator === "not" ? "not " : "";
            lines.push(`- **${field}**: ${opStr}${valueStr}`);
          }
        }
      }
      // Render other fields (skip filters, sortField, sortDirection, limit)
      for (const [key, value] of Object.entries(params)) {
        if (
          [
            "filters",
            "limit",
            "sortField",
            "sortDirection",
            "groupBy",
          ].includes(key)
        )
          continue;
        if (Array.isArray(value)) {
          lines.push(`- **${prettifyKey(key)}**: ${joinWithOr(value)}`);
        } else {
          lines.push(`- **${prettifyKey(key)}**: ${value}`);
        }
      }

      // Special line for sortField/sortDirection
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

    function prettifyKeyValue(key: string, value: unknown, level = 0): string {
      key = prettifyKey(key);
      const prefix = "  ".repeat(level) + "-";
      if (value !== null && typeof value === "object") {
        if (Array.isArray(value)) {
          if (value.length === 0) return `${prefix} *${key}:* (empty)`;
          return [
            `${prefix} *${key}:*`,
            ...value.map((v, i) => prettifyKeyValue(String(i), v, level + 1)),
          ].join("\n");
        } else {
          const entries = Object.entries(value);
          if (entries.length === 0) return `${prefix} *${key}:* (empty)`;
          return [
            `${prefix} *${key}:*`,
            ...entries.map(([k, v]) => prettifyKeyValue(k, v, level + 1)),
          ].join("\n");
        }
      }
      return `${prefix} *${key}:* ${value}`;
    }

    let toolParams = toolCall.function.arguments;
    const toolClient = chatTool.module.call(chatConfig, thread);
    // let toolParamsStr = '`' + toolCall.function.name + '()`:\n```\n' + toolParams + '\n```'

    // when tool === 'planfix_add_to_lead_task', parse toolParams, append messages history to description
    if (toolCall.function.name === "planfix_add_to_lead_task") {
      const lastMessage = thread.msgs[thread.msgs.length - 1];
      const from = lastMessage.from;
      const fromUsername = from?.username || "";
      const fullName = getFullName(lastMessage);
      const msgs = thread.messages
        .filter((msg) => ["user", "system"].includes(msg.role))
        .map((msg) => msg.content)
        .join("\n\n");
      const toolParamsParsed = JSON.parse(toolParams) as {
        message: string;
      };
      if (!toolParamsParsed.message) {
        toolParamsParsed.message = "";
      }
      const fromStr = fromUsername
        ? `От ${fromUsername}${fullName ? `, ${fullName}` : ""}`
        : "";
      toolParamsParsed.message += `\n\nПолный текст:\n${fromStr}\n\n${msgs}`;
      toolParams = JSON.stringify(toolParamsParsed);
    }

    let toolParamsStr: string;
    if (chatTool.name === "expertizeme_search_items") {
      toolParamsStr = prettifyExpertizemeSearchItems(JSON.parse(toolParams));
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

    const chatTitle = (msg.chat as Chat.TitleChat).title;
    const chatId = msg.chat.id;
    // const isMcp = chatTool.module.call(chatConfig, thread).mcp;
    const showMessages = chatConfig.chatParams?.showToolMessages !== false;

    if (toolParams && !chatConfig.chatParams?.confirmation) {
      // send message with tool call params
      log({
        msg: `${toolCall.function.name}: ${toolParams}`,
        chatId,
        chatTitle,
        role: "assistant",
      });
      if (showMessages) {
        // @ts-expect-error - see below for explanation
        sendToHttp(expressRes, toolParamsStr);
        void (await sendTelegramMessage(
          chatId,
          toolParamsStr,
          {
            // parse_mode: 'MarkdownV2',
            deleteAfter: chatConfig.chatParams?.deleteToolAnswers,
          },
          undefined,
          chatConfig,
        ));
      }
    }

    // Execute the tool without confirmation
    if (!chatConfig.chatParams?.confirmation) {
      const { trace } = useLangfuse(msg);
      // Start trace span for the tool call
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

      // Function to execute the tool with retry logic
      const executeTool = async (attempt = 0): Promise<ToolResponse> => {
        try {
          return (await tool(toolParams)) as ToolResponse;
        } catch (error: unknown) {
          const err = error as { status?: number; message?: string };
          // Only retry on 400 errors and only once
          if (
            err.status === 400 &&
            err.message?.includes("Invalid parameter") &&
            attempt === 0
          ) {
            log({
              msg: `Retrying tool ${toolCall.function.name} after 400 error`,
              chatId: msg.chat.id,
              chatTitle: (msg.chat as Chat.TitleChat).title,
              role: "tool",
              logLevel: "warn",
            });
            return executeTool(attempt + 1);
          }
          throw error; // Re-throw if not a 400 error or already retried
        }
      };

      const result = await executeTool();

      if (span) {
        span.end({ output: result.content });
      }
      log({ msg: result.content, chatId, chatTitle, role: "tool" });
      return result;
    }

    // or send confirmation message with Yes/No buttons
    // Confirmation logic can be handled here without returning a new Promise
    // @ts-expect-error - see below for explanation
    sendToHttp(expressRes, `${toolParamsStr}\nDo you want to proceed?`);
    return await sendTelegramMessage(
      msg.chat.id,
      `${toolParamsStr}\n\nDo you want to proceed?`,
      {
        // parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Yes", callback_data: `confirm_tool_${uniqueId}` },
              { text: "No", callback_data: `cancel_tool_${uniqueId}` },
            ],
          ],
        },
        undefined,
        chatConfig,
      },
    );
  });

  if (chatConfig.chatParams?.confirmation) {
    // Handle the callback query
    return new Promise((resolve) => {
      useBot(chatConfig.bot_token!).action(
        `confirm_tool_${uniqueId}`,
        async () => {
          // @ts-expect-error - see below for explanation
          sendToHttp(expressRes, `Yes`);
          const configConfirmed = JSON.parse(JSON.stringify(chatConfig));
          configConfirmed.chatParams.confirmation = false;
          const res = await callTools(
            toolCalls,
            chatTools,
            configConfirmed,
            msg,
          );
          const chatTitle = (msg.chat as Chat.TitleChat).title;
          log({
            msg: "tools called",
            logLevel: "info",
            chatId: msg.chat.id,
            chatTitle,
            role: "tool",
          });
          return resolve(res);
        },
      );
      useBot(chatConfig.bot_token!).action(
        `cancel_tool_${uniqueId}`,
        async () => {
          // @ts-expect-error - see below for explanation
          sendToHttp(expressRes, `Tool execution canceled`);
          await sendTelegramMessage(
            msg.chat.id,
            "Tool execution canceled.",
            undefined,
            undefined,
            chatConfig,
          );
          return resolve([]);
        },
      );
    });
  }

  return Promise.all(toolPromises) as Promise<ToolResponse[]>;
}

export async function getChatTools(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
) {
  // tools change_chat_settings for private chats and admins
  if (msg.chat.type === "private" || isAdminUser(msg)) {
    if (!chatConfig.tools) chatConfig.tools = [];
    if (!chatConfig.tools.includes("change_chat_settings"))
      chatConfig.tools.push("change_chat_settings");
  }

  // add chatAsTool for each bot_name in chatConfig.tools if tool is ToolBotType
  let agentTools: ChatToolType[] = [];
  if (chatConfig.tools) {
    const agentsToolsConfigs = chatConfig.tools.filter((t) => {
      const isAgent = typeof t === "object" && "bot_name" in t;
      if (!isAgent) return false;
      const agentConfig = useConfig().chats.find(
        (c) => c.bot_name === t.bot_name,
      );
      if (!agentConfig) return false;

      // check access when privateUsers is set
      if (agentConfig.privateUsers) {
        const isPrivateUser = agentConfig.privateUsers.includes(
          msg.from?.username || "without_username",
        );
        if (!isPrivateUser) return false;
      }

      return true;
    }) as ToolBotType[];
    agentTools = agentsToolsConfigs.map((t) => chatAsTool({ ...t, msg }));
  }

  // init MCP servers into useTools
  const globalTools = await useTools();
  return [
    ...((chatConfig.tools ?? [])
      .map((f) => globalTools.find((g) => g.name === f))
      .filter(Boolean) as ChatToolType[]),
    ...agentTools,
  ].filter(Boolean);
}

// Get prompts from tools
async function getToolsPrompts(
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
      .filter((f) => !!f),
  );
  const prompts = promptsPromises.filter(Boolean) as string[];
  return prompts || [];
}

async function getToolsSystemMessages(
  chatTools: ChatToolType[],
  chatConfig: ConfigChatType,
  thread: ThreadStateType,
) {
  // systemMessages from tools, should be after tools
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
// join "arguments.command" values with \n when same name, return array unique by name
/*export function groupToolCalls(toolCalls: OpenAI.ChatCompletionMessageToolCall[]) {
  const grouped = {} as { [key: string]: OpenAI.ChatCompletionMessageToolCall[] };
  toolCalls.forEach((toolCall) => {
    const name = toolCall.function.name;
    if (!grouped[name]) {
      grouped[name] = [];
    }
    grouped[name].push(toolCall);
  });

  return Object.values(grouped).map((group) => {
    if (group.length === 1) {
      return group[0];
    }
    const combinedCommand = group.map((call) => JSON.parse(call.function.arguments).command).join('\n');
    return {
      ...group[0],
      function: {...group[0].function, arguments: JSON.stringify({command: combinedCommand})}
    };
  });
}*/
