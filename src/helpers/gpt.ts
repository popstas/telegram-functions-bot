import OpenAI from "openai";
import {ChatToolType, ConfigChatType, GptContextType, ToolResponse} from "../types.ts";
import {useBot} from "../bot.ts";
import {useThreads} from "../threads.ts";
import {getEncoding, TiktokenEncoding} from "js-tiktoken";
import {sendTelegramMessage} from "./telegram.ts";
import {Chat, Message} from "telegraf/types";
import {log, sendToHttp} from '../helpers.ts';
import {Context} from "telegraf";
import express, { Response } from "express";
import {addToHistory, forgetHistory} from "./history.ts";
import {isAdminUser} from "./telegram.ts";
import {useApi} from "./useApi.ts";
import useTools from "./useTools.ts";

type HandleGptAnswerParams = {
  msg: Message.TextMessage;
  res: OpenAI.ChatCompletion;
  chatConfig: ConfigChatType;
  expressRes: express.Response | undefined;
  gptContext: GptContextType;
  level?: number;
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
  level = 1
}: HandleGptAnswerParams): Promise<ToolResponse> {
  const messageAgent = res.choices[0]?.message!;
  
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

  if (gptContext.thread.messages.find((m: OpenAI.ChatCompletionMessageParam) => m.role === 'tool') && chatConfig.chatParams.memoryless) {
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

    if (chatConfig.chatParams?.showToolMessages === true || chatConfig.chatParams?.showToolMessages === undefined) {
      const params = {parse_mode: 'MarkdownV2', deleteAfter: chatConfig.chatParams?.deleteToolAnswers};
      const toolResMessageLimit = 8000;
      const msgContentLimited = toolRes.content.length > toolResMessageLimit ? 
        toolRes.content.slice(0, toolResMessageLimit) + '...' : 
        toolRes.content;
      // @ts-ignore
      sendToHttp(expressRes, msgContentLimited);
      void sendTelegramMessage(msg.chat.id, msgContentLimited, params);
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
  const res = await api.chat.completions.create({
    messages: gptContext.messages,
    model: gptContext.thread.completionParams?.model || 'gpt-4o-mini',
    temperature: gptContext.thread.completionParams?.temperature,
    tools: isNoTool ? undefined : gptContext.tools,
    tool_choice: isNoTool ? undefined : 'auto',
  });

  return await handleGptAnswer({
    msg,
    res,
    chatConfig,
    expressRes,
    gptContext,
    level: level + 1
  });
}

export async function getChatgptAnswer(msg: Message.TextMessage, chatConfig: ConfigChatType, ctx: Context & {
  expressRes?: express.Response
}) {
  if (!msg.text) return
  const threads = useThreads()

  // begin answer, define thread
  const thread = threads[msg.chat?.id || 0]

  // tools change_chat_settings for private chats and admins
  if (msg.chat.type === 'private' || isAdminUser(msg)) {
    if (!chatConfig.tools) chatConfig.tools = []
    if (!chatConfig.tools.includes('change_chat_settings')) chatConfig.tools.push('change_chat_settings')
  }

  // chatTools
  const globalTools = await useTools();
  const chatTools = chatConfig.tools ?
    chatConfig.tools.map(f => globalTools.find(g => g.name === f) as ChatToolType).filter(Boolean) :
    []
  // prompts from tools, should be after tools
  const prompts = await Promise.all(
    chatTools
      .filter(f => typeof f.module.call(chatConfig, thread).prompt_append === 'function')
      .map(async f => await f.module.call(chatConfig, thread).prompt_append())
      .filter(f => !!f)
  )
  // systemMessages from tools, should be after tools
  const systemMessages = await Promise.all(
    chatTools
      .filter(f => typeof f.module.call(chatConfig, thread).systemMessage === 'function')
      .map(async f => await f.module.call(chatConfig, thread).systemMessage())
      .filter(f => !!f)
  )
  const isTools = chatTools.length > 0;
  const tools = isTools ? chatTools.map(f => f.module.call(chatConfig, thread).functions.toolSpecs).flat() : undefined;

  // systemMessage
  let systemMessage = getSystemMessage(chatConfig, systemMessages)
  const date = new Date().toISOString()
  systemMessage = systemMessage.replace(/\{date}/g, date)
  if (thread.nextSystemMessage) {
    systemMessage = thread.nextSystemMessage || ''
    thread.nextSystemMessage = ''
  }

  // messages
  let messages = await buildMessages(systemMessage, thread.messages, chatTools, prompts);

  const api = useApi();
  const res = await api.chat.completions.create({
    messages,
    model: thread.completionParams?.model || 'gpt-4o-mini',
    temperature: thread.completionParams?.temperature,
    // tool_choice: 'required',
    tools,
  });

  const gptContext: GptContextType = {
    thread,
    messages,
    systemMessage,
    chatTools,
    prompts,
    tools
  };

  return await handleGptAnswer({
    msg,
    res,
    chatConfig,
    // @ts-ignore
    expressRes: ctx.expressRes,
    gptContext
  });
}

export async function buildMessages(systemMessage: string, history: OpenAI.ChatCompletionMessageParam[], chatTools: {
  name: string,
  module: any
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
    let toolParams = toolCall.function.arguments
    const toolClient = chatTool.module.call(chatConfig, thread);
    let toolParamsStr = toolCall.function.name + '()`:\n```\n' + toolParams + '\n```'
    if (typeof toolClient.options_string === 'function') {
      toolParamsStr = toolClient.options_string(toolParams)
    }

    const chatTitle = (msg.chat as Chat.TitleChat).title
    const chatId = msg.chat.id

    if (toolParams && !chatConfig.chatParams?.confirmation && chatConfig.chatParams?.showToolMessages !== false) {
      // send message with tool call params
      log({ msg: toolParamsStr, chatId, chatTitle, role: 'assistant' });
      // @ts-ignore
      sendToHttp(expressRes, toolParamsStr);
      void await sendTelegramMessage(chatId, toolParamsStr, {
        parse_mode: 'MarkdownV2',
        deleteAfter: chatConfig.chatParams?.deleteToolAnswers,
      });
    }

    // Execute the tool without confirmation
    if (!chatConfig.chatParams?.confirmation) {
      const result = await tool(toolParams) as ToolResponse;
      log({ msg: result.content, chatId, chatTitle, role: 'tool' });
      return result;
    }

    // or send confirmation message with Yes/No buttons
    return new Promise(async (resolve) => {
      // @ts-ignore
      sendToHttp(expressRes, `${toolParamsStr}\nDo you want to proceed?`);
      await sendTelegramMessage(msg.chat.id, `${toolParamsStr}\nDo you want to proceed?`, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              {text: 'Yes', callback_data: `confirm_tool_${uniqueId}`},
              {text: 'No', callback_data: `cancel_tool_${uniqueId}`}
            ]
          ]
        }
      });

      // Handle the callback query
      /*bot.action(`confirm_tool_${uniqueId}`, async () => {
        const res = await tool(toolParams); // Execute the tool
        log({ msg: res.content, logLevel: 'info', chatId: msg.chat.id, role: 'tool' });
        return resolve(res);
      });
      bot.action(`cancel_tool_${uniqueId}`, async () => {
        await sendTelegramMessage(msg.chat.id, 'Tool execution canceled.');
        return resolve({content: 'Tool execution canceled.'});
      });*/
    });
  });

  if (chatConfig.chatParams.confirmation) {
    // Handle the callback query
    return new Promise(async (resolve) => {
      useBot().action(`confirm_tool_${uniqueId}`, async () => {
        // @ts-ignore
        sendToHttp(expressRes, `Yes`);
        const configConfirmed = JSON.parse(JSON.stringify(chatConfig));;
        configConfirmed.chatParams.confirmation = false;
        const res = await callTools(toolCalls, chatTools, configConfirmed, msg);
        const chatTitle = (msg.chat as Chat.TitleChat).title
        log({ msg: 'tools called', logLevel: 'info', chatId: msg.chat.id, chatTitle, role: 'tool' });
        return resolve(res);
      });
      useBot().action(`cancel_tool_${uniqueId}`, async () => {
        // @ts-ignore
        sendToHttp(expressRes, `Tool execution canceled`);
        await sendTelegramMessage(msg.chat.id, 'Tool execution canceled.');
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
