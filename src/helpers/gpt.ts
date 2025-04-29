import OpenAI from "openai";
import {ChatToolType, ConfigChatType, GptContextType, ToolResponse, ThreadStateType, ToolBotType, ModuleType} from "../types.ts";
import {useBot} from "../bot.ts";
import {useThreads} from "../threads.ts";
import {getEncoding, TiktokenEncoding} from "js-tiktoken";
import {sendTelegramMessage, getTelegramForwardedUser} from "./telegram.ts";
import {Chat, Message} from "telegraf/types";
import {log, sendToHttp} from '../helpers.ts';
import {Context} from "telegraf";
import express, { Response } from "express";
import {addToHistory, forgetHistory} from "./history.ts";
import {isAdminUser} from "./telegram.ts";
import {useApi} from "./useApi.ts";
import useTools from "./useTools.ts";
import useLangfuse from "./useLangfuse.ts";
import {LangfuseTraceClient, observeOpenAI} from "langfuse";
import { useConfig } from "../config.ts";

/**
 * Creates a ChatToolType that proxies tool calls to another bot by bot_name.
 * The internal tool call will use the chat config of the target bot.
 */
export function chatAsTool({ bot_name, name, description, msg }: ToolBotType & { msg: Message.TextMessage }): ChatToolType {
  return {
    name,
    module: {
      description,
      call: (configChat: ConfigChatType, thread: ThreadStateType) => {
        // Find the chat config for the bot_name
        const targetChat = useConfig().chats.find(c => c.bot_name === bot_name);
        if (!targetChat) throw new Error(`Bot with bot_name '${bot_name}' not found`);
        // Proxy to the target bot's tool call (assuming the bot is set up as a tool provider)
        // This assumes the target bot exposes a compatible tool interface
        // You may want to customize this logic for your specific bot integration
        return {
          agent: true,
          functions: {
            get: (toolName: string) => async (args: string) => {
              try {
                // Parse args as message text or object
                let parsedArgs: any;
                try {
                  parsedArgs = typeof args === 'string' ? JSON.parse(args) : args;
                } catch (err) {
                  parsedArgs = { text: args };
                }
                // Build a synthetic Message.TextMessage for the proxy call
                // const msg: Message.TextMessage = {
                //   message_id: Date.now(),
                //   date: Math.floor(Date.now() / 1000),
                //   chat: targetChat,
                //   from: { id: 0, is_bot: true, first_name: 'ToolProxy', username: 'tool_proxy' },
                //   text: parsedArgs.input || parsedArgs.text || args,
                //   ...parsedArgs,
                // };
                // Minimal synthetic context for getChatgptAnswer
                // const ctx: Partial<Context> = {
                //   botInfo: { username: targetChat.bot_name },
                //   chat: targetChat,
                // };

                msg.text = parsedArgs.input || parsedArgs.text || args;

                const agentStartMsg = `Получил ваше сообщение: ${msg.text}`;
                sendTelegramMessage(msg.chat.id, agentStartMsg, undefined, undefined, targetChat);

                const res = await getChatgptAnswer(msg, targetChat);
                const answer = res?.content || '';
                sendTelegramMessage(msg.chat.id, answer, undefined, undefined, targetChat);
                return { content: answer };
              } catch (err: any) {
                return { content: `Proxy tool error for bot '${bot_name}': ${err?.message || err}` };
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
                      description: "Input text for the tool (task, query, etc.)"
                    }
                  },
                  required: ["input"]
                },
              },
            },
          },
          configChat: targetChat,
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
}

type ProcessToolResponseParams = {
  tool_res: ToolResponse[];
  messageAgent: OpenAI.ChatCompletionMessage;
  chatConfig: ConfigChatType;
  msg: Message.TextMessage;
  expressRes: Response | undefined;
  gptContext: GptContextType;
  level: number;
}

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
    throw new Error('No message found in OpenAI response');
  }
  
  if (messageAgent.tool_calls?.length) {
    const tool_res = await callTools(messageAgent.tool_calls, gptContext.chatTools, chatConfig, msg, expressRes);
    if (tool_res) {
      return processToolResponse({
        tool_res,
        messageAgent,
        chatConfig,
        msg,
        expressRes,
        gptContext,
        level
      });
    }
  }

  const answer = res.choices[0]?.message.content || '';
  addToHistory({msg, answer});

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


  if (gptContext.thread.messages.find((m: OpenAI.ChatCompletionMessageParam) => m.role === 'tool') && chatConfig.chatParams?.memoryless) {
    forgetHistory(msg.chat.id);
  }
  
  return {content: answer};
}

export async function processToolResponse({
  tool_res,
  messageAgent,
  chatConfig,
  msg,
  expressRes,
  gptContext,
  level
}: ProcessToolResponseParams): Promise<ToolResponse> {
  gptContext.thread.messages.push(messageAgent);
  
  for (let i = 0; i < tool_res.length; i++) {
    const toolRes = tool_res[i];
    const toolCall = (messageAgent as {
      tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
    }).tool_calls[i];
    const chatTool = gptContext.chatTools.find(f => f.name === toolCall.function.name)
    const isMcp = chatTool?.module.call(chatConfig, gptContext.thread).mcp;
    const showMessages = chatConfig.chatParams?.showToolMessages !== false && !isMcp;
    if (showMessages) {
      const params = {/*parse_mode: 'MarkdownV2',*/ deleteAfter: chatConfig.chatParams?.deleteToolAnswers};
      const toolResMessageLimit = 8000;
      const msgContentLimited = toolRes.content.length > toolResMessageLimit ? 
        toolRes.content.slice(0, toolResMessageLimit) + '...' : 
        toolRes.content;
            sendToHttp(expressRes, msgContentLimited);
      void sendTelegramMessage(msg.chat.id, msgContentLimited, params, undefined, chatConfig);
    }

    const messageTool = {
      role: 'tool',
      content: toolRes.content,
      tool_call_id: toolCall.id,
    } as OpenAI.ChatCompletionToolMessageParam;

    gptContext.thread.messages.push(messageTool);
  }

  gptContext.messages = await buildMessages(
    gptContext.systemMessage, 
    gptContext.thread.messages, 
    gptContext.chatTools, 
    gptContext.prompts
  );

  const isNoTool = level > 6 || !gptContext.tools?.length;

  const api = useApi();
  const apiParams = {
    messages: gptContext.messages,
    model: gptContext.thread.completionParams?.model || 'gpt-4o-mini',
    temperature: gptContext.thread.completionParams?.temperature,
    tools: isNoTool ? undefined : gptContext.tools,
    tool_choice: isNoTool ? undefined : 'auto' as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption,
  };

  const {trace} = useLangfuse(msg, chatConfig);
  let apiFunc = api;
  if (trace) {
    apiFunc = observeOpenAI(api, {
      generationName: 'after-tools',
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

export async function getChatgptAnswer(msg: Message.TextMessage, chatConfig: ConfigChatType, ctx?: Context & {
  expressRes?: express.Response
}) {
  if (!msg.text) return
  const threads = useThreads()

  // add "Forwarded from" to message
  const forwardedName = getTelegramForwardedUser(msg);
  if (forwardedName) {
    msg.text = `Переслано от: ${forwardedName}\n` + msg.text;
  }

  // begin answer, define thread
  let thread = threads[msg.chat?.id || 0]

  // add virtual thread for agentAsTool
  if (!thread) {
    // TODO: remove
    thread = threads[msg.chat?.id] = {
      id: msg.chat?.id,
      msgs: [],
      messages: [],
      completionParams: chatConfig.completionParams,
    }
  }

  // tools change_chat_settings for private chats and admins
  if (msg.chat.type === 'private' || isAdminUser(msg)) {
    if (!chatConfig.tools) chatConfig.tools = []
    if (!chatConfig.tools.includes('change_chat_settings')) chatConfig.tools.push('change_chat_settings')
  }

  // add chatAsTool for each bot_name in chatConfig.tools if tool is ToolBotType
  let agentTools: ChatToolType[] = [];
  if (chatConfig.tools) {
    const agentsToolsConfigs = chatConfig.tools.filter(t => typeof t === 'object' && 'bot_name' in t) as ToolBotType[]
    agentTools = agentsToolsConfigs.map(t => chatAsTool({...t, msg}))
  }
      
    
  
  // init MCP servers into useTools
  const globalTools = await useTools()
  const chatTools = [
    ...((chatConfig.tools ?? []).map(f => globalTools.find(g => g.name === f)).filter(Boolean) as ChatToolType[]),
    ...agentTools
  ].filter(Boolean)

  // prompts from tools, should be after tools
  const promptsPromises = await Promise.all(
    chatTools
      .map(async f => {
        const module = f.module.call(chatConfig, thread)
        if (typeof module.prompt_append === 'function') {
          return module.prompt_append()
        }
        return null
      })
      .filter(f => !!f)
  )
  const prompts = promptsPromises.filter(Boolean) as string[]
  // systemMessages from tools, should be after tools
  const systemMessagesPromises = await Promise.all(
    chatTools
      .map(async f => {
        const module = f.module.call(chatConfig, thread)
        if (typeof module.systemMessage === 'function') {
          return module.systemMessage()
        }
        return null
      })
      .filter(Boolean)  
  );
  const systemMessages = systemMessagesPromises.filter(Boolean) as string[]

  const isTools = chatTools.length > 0;
  const tools = isTools ? [
    ...chatTools.map(f => f.module.call(chatConfig, thread).functions.toolSpecs).flat(),
  ] as OpenAI.Chat.Completions.ChatCompletionTool[] : undefined;

  // systemMessage
  let systemMessage = getSystemMessage(chatConfig, systemMessages)
  const date = new Date().toISOString()
  systemMessage = systemMessage.replace(/\{date}/g, date)
  if (thread.nextSystemMessage) {
    systemMessage = thread.nextSystemMessage || ''
    thread.nextSystemMessage = ''
  }

  // messages
  const messages = await buildMessages(systemMessage, thread.messages, chatTools, prompts);

  const api = useApi();
  const apiParams = {
    messages,
    model: thread.completionParams?.model || 'gpt-4o-mini',
    temperature: thread.completionParams?.temperature,
    // tool_choice: 'required',
    tools,
  };
  const {trace} = useLangfuse(msg, chatConfig);
  let apiFunc = api;
  if (trace) {
    apiFunc = observeOpenAI(api, {
      generationName: 'llm-call',
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

export async function buildMessages(systemMessage: string, history: OpenAI.ChatCompletionMessageParam[], chatTools: {
  name: string,
  module: unknown // or specify the actual type if possible
}[], prompts: string[]) {
  const limit = 7 // TODO: to config
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemMessage,
    },
  ];

  // limit history
  history = history.slice(-limit)

  // remove role: tool message from history if is first message
  if (history.length && history[0].role === 'tool') {
    history.shift()
  }

  messages.push(...history)

  if (prompts.length) {
    messages.push({role: 'system', content: prompts.join('\n\n')})
  }

  return messages
}

export function getSystemMessage(chatConfig: ConfigChatType, systemMessages: string[]): string {
  if (chatConfig.systemMessage) return chatConfig.systemMessage
  if (systemMessages.length > 0) return systemMessages[0]
  return 'You are using functions to answer the questions. Current date: {date}'
}

export function getTokensCount(chatConfig: ConfigChatType, text: string) {
  const encoding: TiktokenEncoding = chatConfig.completionParams.model.includes('4o') ? 'o200k_base' : 'cl100k_base';
  const tokenizer = getEncoding(encoding);
  return tokenizer.encode(text).length
}

export async function callTools(toolCalls: OpenAI.ChatCompletionMessageToolCall[], chatTools: ChatToolType[], chatConfig: ConfigChatType, msg: Message.TextMessage, expressRes?: Express.Response): Promise<ToolResponse[]> {
  // toolCalls = groupToolCalls(toolCalls) // don't need to group anymore

  const thread = useThreads()[msg.chat.id || 0]

  // Check for 'confirm' or 'noconfirm' in the message to set confirmation
  if (msg.text.includes('noconfirm')) {
    chatConfig = JSON.parse(JSON.stringify(chatConfig));
    chatConfig.chatParams.confirmation = false;
    msg.text = msg.text.replace('noconfirm', '');
  } else if (msg.text.includes('confirm')) {
    chatConfig = JSON.parse(JSON.stringify(chatConfig));
    chatConfig.chatParams.confirmation = true;
    msg.text = msg.text.replace('confirm', '');
  }

  const uniqueId = Date.now().toString();

  const toolPromises = toolCalls.map(async (toolCall) => {
    const chatTool = chatTools.find(f => f.name === toolCall.function.name)
    if (!chatTool) return {content: `Tool not found: ${toolCall.function.name}`};

    const tool = chatTool.module.call(chatConfig, thread).functions.get(toolCall.function.name)
    if (!tool) return {content: `Tool not found! ${toolCall.function.name}`};
    const toolParams = toolCall.function.arguments
    const toolClient = chatTool.module.call(chatConfig, thread);
    // let toolParamsStr = '`' + toolCall.function.name + '()`:\n```\n' + toolParams + '\n```'

    function joinWithOr(arr: string[]): string {
      if (arr.length === 0) return '';
      if (arr.length === 1) return arr[0];
      return arr.slice(0, -1).join(', ') + ' or ' + arr[arr.length - 1];
    }

    function prettifyKey(key?: string): string {
      if (!key) return '';
      // replace _ or - with space
      key = key.replace(/[_-]/g, ' ');
      // split camelCase
      key = key.replace(/([a-z])([A-Z])/g, '$1 $2');
      // uppercase first letter
      key = key.charAt(0).toUpperCase() + key.slice(1);
      return key;
    }

    function prettifyExpertizemeSearchItems(params: Record<string, any>): string {
      const lines: string[] = [
        '`Поиск СМИ:`'
      ];
      // Render filters first, as flat list
      if (Array.isArray(params.filters)) {
        for (const filter of params.filters) {
          if (typeof filter === 'object' && filter !== null) {
            const field = prettifyKey(filter.field) || '';
            const operator = filter.operator || '';
            const value = filter.value;
            let valueStr = '';
            if (Array.isArray(value)) {
              valueStr = joinWithOr(value);
            } else {
              valueStr = value !== undefined ? String(value) : '';
            }
            // Special case: if operator is 'not', output 'not Value', else 'Value'
            const opStr = operator === 'not' ? 'not ' : '';
            lines.push(`- **${field}**: ${opStr}${valueStr}`);
          }
        }
      }
      // Render other fields (skip filters, sortField, sortDirection, limit)
      for (const [key, value] of Object.entries(params)) {
        if (['filters', 'limit', 'sortField', 'sortDirection', 'groupBy'].includes(key)) continue;
        if (Array.isArray(value)) {
          lines.push(`- **${prettifyKey(key)}**: ${joinWithOr(value)}`);
        } else {
          lines.push(`- **${prettifyKey(key)}**: ${value}`);
        }
      }

      // Special line for sortField/sortDirection
      if (params.sortField) {
        const sortLine = '- **Sort by** ' + prettifyKey(params.sortField) +
          (params.sortDirection === 'desc' ? ' (descending)' : '');
        lines.push(sortLine);
      }
      if(params.groupBy) {
        const groupByLine = '- **Group by** ' + prettifyKey(params.groupBy);
        lines.push(groupByLine);
      }

      return lines.join('\n');
    }

    function prettifyKeyValue(key: string, value: any, level = 0): string {
      key = prettifyKey(key);
      const prefix = '  '.repeat(level) + '-';
      if (value !== null && typeof value === 'object') {
        if (Array.isArray(value)) {
          if (value.length === 0) return `${prefix} *${key}:* (empty)`;
          return [
            `${prefix} *${key}:*`,
            ...value.map((v, i) => prettifyKeyValue(String(i), v, level + 1))
          ].join('\n');
        } else {
          const entries = Object.entries(value);
          if (entries.length === 0) return `${prefix} *${key}:* (empty)`;
          return [
            `${prefix} *${key}:*`,
            ...entries.map(([k, v]) => prettifyKeyValue(k, v, level + 1))
          ].join('\n');
        }
      }
      return `${prefix} *${key}:* ${value}`;
    }

    let toolParamsStr: string;
    if (chatTool.name === 'expertizeme_search_items') {
      toolParamsStr = prettifyExpertizemeSearchItems(JSON.parse(toolParams));
    } else {
      toolParamsStr = [
        '`' + (toolClient.agent ? 'Agent: ' : '') + toolCall.function.name.replace(/[_-]/g, ' ') + ':`',
        ...Object.entries(JSON.parse(toolParams)).map(([key, value]) => prettifyKeyValue(key, value)),
      ].join('\n');
    }
    if (typeof toolClient.options_string === 'function') {
      toolParamsStr = toolClient.options_string(toolParams)
    }

    const chatTitle = (msg.chat as Chat.TitleChat).title
    const chatId = msg.chat.id
    // const isMcp = chatTool.module.call(chatConfig, thread).mcp;
    const showMessages = chatConfig.chatParams?.showToolMessages !== false;

    if (toolParams && !chatConfig.chatParams?.confirmation) {
      // send message with tool call params
      log({ msg: `${toolCall.function.name}: ${toolParams}`, chatId, chatTitle, role: 'assistant' });
      if (showMessages) {
        // @ts-expect-error - see below for explanation
        sendToHttp(expressRes, toolParamsStr);
        void await sendTelegramMessage(chatId, toolParamsStr, {
          // parse_mode: 'MarkdownV2',
          deleteAfter: chatConfig.chatParams?.deleteToolAnswers,
        }, undefined, chatConfig);
      }
    }

    // Execute the tool without confirmation
    if (!chatConfig.chatParams?.confirmation) {
      const {trace} = useLangfuse(msg);
      // Start trace span for the tool call
      let span;
      if (trace) {
        span = trace.span({
          name: toolClient.agent ? `agent_call: ${toolCall.function.name}` : `tool_call: ${toolCall.function.name}`,
          metadata: { tool: toolCall.function.name },
          input: JSON.parse(toolParams)
        });
      }
      const result = await tool(toolParams) as ToolResponse;
      if (span) {
        span.end({ output: result.content });
      }
      log({ msg: result.content, chatId, chatTitle, role: 'tool' });
      return result;
    }

    // or send confirmation message with Yes/No buttons
    // Confirmation logic can be handled here without returning a new Promise
    // @ts-expect-error - see below for explanation
    sendToHttp(expressRes, `${toolParamsStr}\nDo you want to proceed?`);
    return await sendTelegramMessage(msg.chat.id, `${toolParamsStr}\n\nDo you want to proceed?`, {
      // parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            {text: 'Yes', callback_data: `confirm_tool_${uniqueId}`},
            {text: 'No', callback_data: `cancel_tool_${uniqueId}`}
          ]
        ]
      }, undefined, chatConfig
    });
  });

  if (chatConfig.chatParams?.confirmation) {
    // Handle the callback query
    return new Promise((resolve) => {
      useBot(chatConfig.bot_token!).action(`confirm_tool_${uniqueId}`, async () => {
        // @ts-expect-error - see below for explanation
        sendToHttp(expressRes, `Yes`);
        const configConfirmed = JSON.parse(JSON.stringify(chatConfig));
        configConfirmed.chatParams.confirmation = false;
        const res = await callTools(toolCalls, chatTools, configConfirmed, msg);
        const chatTitle = (msg.chat as Chat.TitleChat).title
        log({ msg: 'tools called', logLevel: 'info', chatId: msg.chat.id, chatTitle, role: 'tool' });
        return resolve(res);
      });
      useBot(chatConfig.bot_token!).action(`cancel_tool_${uniqueId}`, async () => {
        // @ts-expect-error - see below for explanation
        sendToHttp(expressRes, `Tool execution canceled`);
        await sendTelegramMessage(msg.chat.id, 'Tool execution canceled.', undefined, undefined, chatConfig);
        return resolve([]);
      });
    })
  }

  return Promise.all(toolPromises) as Promise<ToolResponse[]>
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
