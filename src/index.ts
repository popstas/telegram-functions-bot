import {Telegraf, Context} from 'telegraf'
import {message, editedMessage} from 'telegraf/filters'
import {getEncoding, TiktokenEncoding} from 'js-tiktoken'
import telegramifyMarkdown from 'telegramify-markdown'
import {Message, Chat, Update} from 'telegraf/types'
import OpenAI from 'openai'
import debounce from 'lodash.debounce'
import {watchFile} from 'fs'
import {
  ConfigType,
  ConfigChatType,
  ThreadStateType,
  CompletionParamsType,
  ConfigChatButtonType, ToolResponse,
} from './types'
import {readConfig} from './config'
import {HttpsProxyAgent} from "https-proxy-agent"

const threads = {} as { [key: number]: ThreadStateType }

const configPath = process.env.CONFIG || 'config.yml'
let config: ConfigType
let bot: Telegraf<Context>
let api: OpenAI
let functionModules: { [key: string]: any } = {}

// watch config file
watchFile(configPath, debounce(() => {
  console.log('reload config...')
  config = readConfig(configPath)
  console.log('config:', config)

  config.chats.filter(c => c.debug && threads[c.id]).forEach((c) => {
    console.log('clear debug chat:', c.name)
    forgetHistory(c.id)
    threads[c.id].customSystemMessage = ''
  })
}, 2000))

/*onunhandledrejection = (reason, p) => {
  console.log('Unhandled Rejection at:', p, 'reason:', reason);
}*/

process.on('uncaughtException', (error, source) => {
  console.log('Uncaught Exception:', error)
  console.log('source:', source)
})

void start()

async function start() {
  config = readConfig(configPath);

  const httpAgent = config.proxyUrl ? new HttpsProxyAgent(`${config.proxyUrl}`) : undefined;

  try {
    api = new OpenAI({
      apiKey: config.auth.chatgpt_api_key,
      httpAgent,
    })

    bot = new Telegraf(config.auth.bot_token)
    console.log('bot started')
    // bot.on('channel_post', onMessage);

    bot.help(async ctx => ctx.reply(config.helpText))

    bot.command('forget', async ctx => {
      forgetHistory(ctx.chat.id)
      return await ctx.telegram.sendMessage(ctx.chat.id, 'OK')
    })

    bot.command('info', async ctx => {
      const chat = getChatConfig(ctx.chat)
      if (!chat) return
      const answer = getInfoMessage(chat)
      return sendTelegramMessage(ctx.chat.id, answer)
    })

    // bot.on([message('text'), editedMessage('text')], onMessage)
    bot.on([message('text'), editedMessage('text')], onMessageDebounced)

    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))
    void bot.launch()

    await bot.telegram.setMyCommands([
      /*{
        command: '/help',
        description: 'Показать справку',
      },*/
      {
        command: '/forget',
        description: 'Забыть историю сообщений',
      },
      {
        command: '/info',
        description: 'Начальные установки',
      },
    ])

    // Import all functions dynamically based on config.functions array
    for (const func of config.functions) {
      const mod = await import(`./functions/${func}.ts`)
      if (typeof mod.call === 'function') {
        functionModules[func] = mod
      }
    }

  } catch (e) {
    console.log('restart after 5 seconds...')
    setTimeout(start, 5000)
  }
}

function getChatConfig(ctxChat: Chat) {
  let chat = config.chats.find(c => c.id == ctxChat?.id || 0) || {} as ConfigChatType
  if (!chat.id) {
    // console.log("ctxChat:", ctxChat);
    if (ctxChat?.type !== 'private') {
      console.log(`This is ${ctxChat?.type} chat, not in whitelist: ${ctxChat.id}`)
      return
    }

    // default chat, with name 'default'
    const defaultChat = config.chats.find(c => c.name === 'default')
    // console.log("defaultChat:", defaultChat);
    if (defaultChat) chat = defaultChat

    if (ctxChat?.type === 'private') {
      const privateChat = ctxChat as Chat.PrivateChat
      const isAllowed = config.allowedPrivateUsers?.includes(privateChat.username || '')
      if (!isAllowed) {
        return
      }

      // user chat, with username
      const userChat = config.chats.find(c => c.username === privateChat.username || '')
      if (userChat) chat = {...defaultChat, ...userChat}
    }

    if (!chat && defaultChat) chat = defaultChat
  }
  return chat
}

function addToHistory({msg, answer, systemMessage, completionParams}: {
  msg: Message.TextMessage;
  answer?: string,
  systemMessage?: string;
  completionParams?: CompletionParamsType;
}) {
  const key = msg.chat?.id || 0
  if (!threads[key]) {
    threads[key] = {
      history: [],
      messages: [],
      // lastAnswer: undefined,
      partialAnswer: '',
      customSystemMessage: systemMessage || config.systemMessage,
      completionParams: completionParams || config.completionParams,
    }
  }
  const messageItem = {} as OpenAI.ChatCompletionMessageParam;
  if (answer) {
    messageItem.role = 'system'
    messageItem.content = answer
  } else {
    messageItem.role = 'user'
    messageItem.content = msg.text || ''
  }
  threads[key].messages.push(messageItem)
}

function forgetHistory(chatId: number) {
  if (threads[chatId]) {
    threads[chatId].history = [];
    threads[chatId].messages = [];
  }
}

/*function getHistory(msg: Context) {
  return threads[msg.chat?.id || 0].history || [];
}*/

function buildMessages(systemMessage: string, history: OpenAI.ChatCompletionMessageParam[]) {
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemMessage,
    },
  ];
  messages.push(...history)

  return messages
}

async function getChatgptAnswer(msg: Message.TextMessage, chatConfig: ConfigChatType) {
  if (!msg.text) return

  const thread = threads[msg.chat?.id || 0]
  let systemMessage = thread?.customSystemMessage || getSystemMessage(chatConfig)
  if (thread?.nextSystemMessage) {
    systemMessage = thread.nextSystemMessage || ''
    thread.nextSystemMessage = ''
  }

  const date = new Date().toISOString()
  systemMessage = systemMessage.replace(/\{date}/g, date)

  // let typingSent = false

  let messages = buildMessages(systemMessage, thread.messages);

  console.log(msg.text);

  const chatTools = chatConfig.functions ? chatConfig.functions.map(f => functionModules[f]).filter(Boolean) : []
  const tools = chatTools.map(f => f.call(chatConfig).functions.toolSpecs).flat()
  const res = await api.chat.completions.create({
    messages,
    model: thread.completionParams?.model || config.completionParams.model,
    temperature: thread.completionParams?.temperature || config.completionParams.temperature,
    // tools: thread.completionParams?.functions,
    // tool_choice: 'required',
    tools,
    // tools: weather.functions.toolSpecs,
    // tools: wikipedia.functions.toolSpecs,
    // tool_choice: 'auto',
  });

  function isTestUser(msg: Message.TextMessage) {
    return config.testUsers?.includes(msg.from?.username || '');
  }

  function callTools(toolCalls: OpenAI.ChatCompletionMessageToolCall[], dryRun: boolean = false) {
    const toolPromises = toolCalls.map(async (toolCall) => {
      const tool = chatTools[0].call(chatConfig).functions.get(toolCall.function.name)
      if (!tool) return
      let toolParams = toolCall.function.arguments

      // add full cite
      const params = JSON.parse(toolParams)
      if (params.command) {
        // msg is global
        void await sendTelegramMessage(msg.chat.id, '```\n'+params.command+'\n```', {parse_mode: 'MarkdownV2'});
      }
      // const msgs = thread.messages.map(msg => msg.content).join('\n\n');
      // params.description += `\n\nПолный текст:\n${msgs}`
      // toolParams = JSON.stringify(params)

      const toolResult = {
        args: {command: params.command},
        content: 'empty result',
      }

      return (!dryRun ? await tool(toolParams) : toolResult) as ToolResponse
    })
    return Promise.all(toolPromises) as Promise<ToolResponse[]>
  }

  const message = res.choices[0]?.message!
  if (message.tool_calls?.length) {
    const dryRun = isTestUser(msg);
    const tool_res = await callTools(message.tool_calls, dryRun);

    if (tool_res) {
      const toolRes = tool_res[0] as ToolResponse;
      console.log(toolRes.content);
      void await sendTelegramMessage(msg.chat.id, toolRes.content, {parse_mode: 'MarkdownV2'});
      console.log('');

      messages = [...messages, {role: 'system', content: `> ${toolRes?.args?.command}:\n${toolRes.content}`}];

      const res = await api.chat.completions.create({
        messages,
        model: thread.completionParams?.model || config.completionParams.model,
        temperature: thread.completionParams?.temperature || config.completionParams.temperature,
        tools,
        tool_choice: 'auto',
      });

      forgetHistory(msg.chat.id);

      const message = res.choices[0]?.message?.content!
      return {content: message};
    }
  }

  const answer = res.choices[0]?.message.content || ''
  addToHistory({msg, answer, systemMessage});
  return {content: answer}
}

function defaultSystemMessage() {
  return `You answer as concisely as possible for each response. If you are generating a list, do not have too many items.
Current date: ${new Date().toISOString()}\n\n`
}

function getSystemMessage(chatConfig: ConfigChatType) {
  return threads[chatConfig.id]?.customSystemMessage || chatConfig.systemMessage || config.systemMessage || defaultSystemMessage()
}

function splitBigMessage(text: string) {
  const msgs: string[] = []
  const sizeLimit = 4096
  let msg = ''
  for (const line of text.split('\n')) {
    if (msg.length + line.length > sizeLimit) {
      // console.log("split msg:", msg);
      msgs.push(msg)
      msg = ''
    }
    msg += line + '\n'
  }
  msgs.push(msg)
  return msgs
}

async function sendTelegramMessage(chat_id: number, text: string, extraMessageParams?: any) {
  return new Promise((resolve) => {

    const msgs = splitBigMessage(text)
    if (msgs.length > 1) console.log(`Split into ${msgs.length} messages`)

    const params = {
      ...extraMessageParams,
      // disable_web_page_preview: true,
      // disable_notification: true,
      // parse_mode: 'HTML'
    }

    msgs.forEach(async (msg) => {
      await bot.telegram.sendMessage(chat_id, msg, params)
    })
    resolve(true)
  })
}

function getTokensCount(text: string) {
  const encoding: TiktokenEncoding = config.completionParams.model.includes('4o') ? 'o200k_base' : 'cl100k_base';
  const tokenizer = getEncoding(encoding);
  return tokenizer.encode(text).length
}

function getInfoMessage(chat: ConfigChatType) {
  const systemMessage = getSystemMessage(chat)
  const tokens = getTokensCount(systemMessage)
  let answer = 'Начальная установка: ' + systemMessage + '\n' + 'Токенов: ' + tokens + '\n'
  if (chat.completionParams?.model) {
    answer = `Модель: ${chat.completionParams.model}\n\n` + answer
  }
  return answer
}

async function onMessageDebounced(ctx: Context & { secondTry?: boolean }) {
  return await onMessage(ctx)
}

async function onMessage(ctx: Context & { secondTry?: boolean }) {
  // console.log("ctx:", ctx);

  let ctxChat: Chat | undefined
  let msg: Message.TextMessage & {forward_origin?: any } | undefined

  // edited message
  if (ctx.hasOwnProperty('update')) {
    // console.log("ctx.update:", ctx.update);
    const updateEdited = ctx.update as Update.EditedMessageUpdate //{ edited_message: Message.TextMessage, chat: Chat };
    const updateNew = ctx.update as Update.MessageUpdate
    msg = (updateEdited.edited_message || updateNew.message) as Message.TextMessage
    // console.log("msg:", msg);
    ctxChat = msg?.chat
    // console.log('no message in ctx');
    // return;
  }

  if (!msg) {
    console.log('no ctx message detected')
    return
  }

  if (!ctxChat) {
    console.log('no ctx chat detected')
    return
  }

  const chat = getChatConfig(ctxChat)

  if (!chat) {
    console.log(`Not in whitelist: }`, msg.from)
    return await ctx.telegram.sendMessage(ctxChat.id, `You are not allowed to use this bot.
Your username: ${msg.from?.username}, chat id: ${msg.chat.id}`)
  }

  // console.log('chat:', chat)
  const extraMessageParams = {reply_to_message_id: ctx.message?.message_id}

  const forwardOrigin = msg.forward_origin;
  const username = forwardOrigin?.sender_user?.username
  const isOurUser = username && config.allowedPrivateUsers?.includes(username)
  if (forwardOrigin && !isOurUser) {
    const name = forwardOrigin.type === 'hidden_user' ?
      forwardOrigin.sender_user_name :
      `${forwardOrigin.sender_user.first_name ?? ''} ${forwardOrigin.sender_user.last_name ?? ''}`.trim()
    const username = forwardOrigin?.sender_user?.username;
    msg.text = `Переслано от: ${name}` +
      `${username ? `, Telegram: @${username}` : ''}\n` + msg.text
  }

  // console.log("ctx.message.text:", ctx.message?.text);
  addToHistory({
    msg,
    systemMessage: getSystemMessage(chat),
    completionParams: chat.completionParams,
  })

  const thread = threads[msg.chat.id]

  // replace msg.text to button.prompt if match button.name
  let matchedButton: ConfigChatButtonType | undefined = undefined
  const activeButton = thread.activeButton
  const buttons = chat.buttons
  if (buttons) {

    // message == button.name
    matchedButton = buttons.find(b => b.name === msg?.text || '')
    if (matchedButton) {
      msg.text = matchedButton.prompt || ''

      // send ask for text message
      if (matchedButton.waitMessage) {
        thread.activeButton = matchedButton
        return await sendTelegramMessage(msg.chat.id, matchedButton.waitMessage, extraMessageParams)
      }
    }

    // received text, send prompt with text in the end
    if (activeButton) {
      forgetHistory(msg.chat.id)
      thread.nextSystemMessage = activeButton.prompt
      thread.activeButton = undefined
    }
  }

  // answer only to prefixed message
  if (chat.prefix && !matchedButton && !activeButton) {
    const re = new RegExp(`^${chat.prefix}`, 'i')
    const isBot = re.test(msg.text)
    if (!isBot) {
      // console.log("not to bot:", ctx.chat);
      return
    }
  }

  // skip replies to other people
  if (msg.reply_to_message && msg.from?.username !== msg.reply_to_message.from?.username) {
    if (msg.reply_to_message.from?.username !== config.bot_name) return
  }

  // prog system message
  if (chat.progPrefix) {
    const re = new RegExp(`^${chat.progPrefix}`, 'i')
    const isProg = re.test(msg.text)
    if (isProg) {
      thread.customSystemMessage = msg.text.replace(re, '').trim()
      forgetHistory(msg.chat.id)
      if (thread.customSystemMessage === '') {
        return await ctx.telegram.sendMessage(msg.chat.id, 'Начальная установка сброшена')
      } else {
        thread.customSystemMessage = `Я ${thread.customSystemMessage}`
        return await sendTelegramMessage(msg.chat.id, 'Сменил начальную установку на: ' + thread.customSystemMessage)
      }
    }
  }

  const historyLength = thread.messages.length
  setTimeout(async () => {
    if (thread.messages.length !== historyLength) {
      // skip if new messages added
      return
    }
    await answerToMessage(ctx, msg, chat, extraMessageParams)
  }, 500)
}

// send request to chatgpt, answer to telegram
async function answerToMessage(ctx: Context & { secondTry?: boolean }, msg: Message.TextMessage, chat: ConfigChatType, extraMessageParams: any) {
  const thread = threads[msg.chat.id];
  try {
    await ctx.persistentChatAction('typing', async () => {
      if (!msg) return
      thread.partialAnswer = ''
      const res = await getChatgptAnswer(msg, chat)
      thread.partialAnswer = ''
      // if (config.debug) console.log('res:', res)

      let text = res?.content || 'бот не ответил'

      text = telegramifyMarkdown(`${text}`)

      const extraParams: any = {
        ...extraMessageParams,
        ...{parse_mode: 'MarkdownV2'}
      }
      const buttons = chat.buttons
      if (buttons) {
        const buttonRows = buildButtonRows(buttons)
        extraParams.reply_markup = {keyboard: buttonRows, resize_keyboard: true}
      }

      void await sendTelegramMessage(msg.chat.id, text, extraParams)
    }) // all done, stops sending typing
  } catch (e) {
    const error = e as { message: string }
    console.log('error:', error)

    if (ctx.secondTry) return

    if (!ctx.secondTry && error.message.includes('context_length_exceeded')) {
      ctx.secondTry = true
      forgetHistory(msg.chat.id)
      void onMessage(ctx) // специально без await
    }

    if (thread.partialAnswer !== '') {
      const answer = `Бот ответил частично и забыл диалог:\n\n${error.message}\n\n${thread.partialAnswer}`
      forgetHistory(msg.chat.id)
      thread.partialAnswer = ''
      return await sendTelegramMessage(msg.chat.id, answer, extraMessageParams)
    } else {
      return await sendTelegramMessage(msg.chat.id, `${error.message}${ctx.secondTry ? '\n\nПовторная отправка последнего сообщения...' : ''}`, extraMessageParams)
    }
  }
}

function buildButtonRows(buttons: ConfigChatButtonType[]) {
  const buttonRows: { text: string }[][] = [[]]
  // console.log("thread.buttons:", thread.buttons);
  // console.log("chat.buttons:", chat.buttons);
  buttons.forEach(b => {
    b.row = b.row || 1
    const index = b.row - 1
    buttonRows[index] = buttonRows[index] || []
    buttonRows[index].push({text: b.name})
  })
  return buttonRows
}
