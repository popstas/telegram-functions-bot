import {Message} from "telegraf/types";
import {ChatToolType, ConfigChatType, ToolResponse} from "../types.ts";
import {Context} from "telegraf";
import express from "express";
import {useThreads} from "../threads.ts";
import OpenAI from "openai";
import {buildMessages, callTools, getSystemMessage} from "./gpt.ts";
import {addToHistory, forgetHistory} from "./history.ts";
import {isAdminUser} from "./telegram.ts";
import {handleGptAnswer} from "./gptAnswerHandler.ts";
import {useApi} from "./useApi.ts"
import useTools from "./useTools.ts";

export default async function getChatgptAnswer(msg: Message.TextMessage, chatConfig: ConfigChatType, ctx: Context & {
  expressRes?: express.Response
}) {
  if (!msg.text) return
  const threads = useThreads()



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

  const gptContext: GptContextType = {
    thread,
    messages,
    systemMessage,
    chatTools,
    prompts,
    tools
  };

  return await handleGptAnswer(
    msg,
    res,
    chatConfig,
    ctx.expressRes,
    gptContext
  );
}
