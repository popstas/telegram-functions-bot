import {Message} from "telegraf/types";
import {ChatToolType, ConfigChatType, ToolResponse} from "../types.ts";
import {Context} from "telegraf";
import express from "express";
import {useThreads} from "../threads.ts";
import OpenAI from "openai";
import {buildMessages, callTools, getSystemMessage} from "./gpt.ts";
import {addToHistory, forgetHistory} from "./history.ts";
import {sendToHttp} from "../helpers.ts";
import {isAdminUser, sendTelegramMessage} from "./telegram.ts";
import {useApi} from "./useApi.ts"
import useTools from "./useTools.ts";

export default async function getChatgptAnswer(msg: Message.TextMessage, chatConfig: ConfigChatType, ctx: Context & {
  expressRes?: express.Response
}) {
  if (!msg.text) return
  const threads = useThreads()

  // async function onGptAnswer(msg: Message.TextMessage, res: OpenAI.ChatCompletionMessage) {
  async function onGptAnswer(msg: Message.TextMessage, res: OpenAI.ChatCompletion, level: number = 1): Promise<ToolResponse> {
    // console.log(`onGptAnswer, level ${level}`)
    const messageAgent = res.choices[0]?.message!
    if (messageAgent.tool_calls?.length) {
      const tool_res = await callTools(messageAgent.tool_calls, chatTools, chatConfig, msg, ctx.expressRes);
      if (tool_res) {
        return processToolResponse(tool_res, messageAgent, level);
      }
    }

    const answer = res.choices[0]?.message.content || ''
    addToHistory({msg, answer});

    // forget after tool
    if (thread.messages.find(m => m.role === 'tool') && chatConfig.chatParams.memoryless) {
      forgetHistory(msg.chat.id);
    }
    return {content: answer}
  }

  async function processToolResponse(tool_res: ToolResponse[], messageAgent: OpenAI.ChatCompletionMessage, level: number): Promise<ToolResponse> {
    thread.messages.push(messageAgent);
    for (let i = 0; i < tool_res.length; i++) {
      const toolRes = tool_res[i];
      const toolCall = (messageAgent as {
        tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]
      }).tool_calls[i];
      // console.log(`tool result:`, toolRes?.content);

      // show answer message
      if (chatConfig.chatParams?.showToolMessages === true || chatConfig.chatParams?.showToolMessages === undefined) {
        const params = {parse_mode: 'MarkdownV2', deleteAfter: chatConfig.chatParams?.deleteToolAnswers};
        const toolResMessageLimit = 8000;
        const msgContentLimited = toolRes.content.length > toolResMessageLimit ? toolRes.content.slice(0, toolResMessageLimit) + '...' : toolRes.content;
        sendToHttp(ctx.expressRes, msgContentLimited);
        void sendTelegramMessage(msg.chat.id, msgContentLimited, params);
      }

      console.log('');

      const messageTool = {
        role: 'tool',
        content: toolRes.content,
        tool_call_id: toolCall.id,
      } as OpenAI.ChatCompletionToolMessageParam

      thread.messages.push(messageTool)
    }

    messages = await buildMessages(systemMessage, thread.messages, chatTools, prompts);

    const isNoTool = level > 6 || !tools?.length;

    const api = useApi();
    const res = await api.chat.completions.create({
      messages,
      model: thread.completionParams?.model || 'gpt-4o-mini',
      temperature: thread.completionParams?.temperature,
      // cannot use functions at 6+ level of chaining
      tools: isNoTool ? undefined : tools,
      tool_choice: isNoTool ? undefined : 'auto',
    });

    return await onGptAnswer(msg, res, level + 1);
  }


  // begin answer, define thread
  const thread = threads[msg.chat?.id || 0]

  // tools change_chat_settings for private chats and admins
  if (msg.chat.type === 'private' || isAdminUser(msg)) {
    if (!chatConfig.tools) chatConfig.tools = []
    chatConfig.tools.push('change_chat_settings')
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

  return await onGptAnswer(msg, res);
}
