import {Telegraf, Context} from 'telegraf'
import {message, editedMessage} from 'telegraf/filters'
import telegramifyMarkdown from 'telegramify-markdown'
import {Message} from 'telegraf/types'
import OpenAI from 'openai'
import debounce from 'lodash.debounce'
import {watchFile, readdirSync} from 'fs'
import {
  ConfigType,
  ConfigChatType,
  ThreadStateType,
  ConfigChatButtonType, ToolResponse, ChatToolType,
} from './types'
import {readConfig, writeConfig} from './config'
import {HttpsProxyAgent} from "https-proxy-agent"
import {addOauthToThread, commandGoogleOauth, ensureAuth} from "./helpers/google.ts";
import {buildButtonRows, getCtxChatMsg, isAdminUser, sendTelegramMessage} from "./helpers/telegram.ts";
import {buildMessages, callTools, getSystemMessage, getTokensCount} from "./helpers/gpt.ts";
import {addToHistory, forgetHistory} from "./helpers/history.ts";
import {log} from './helpers.ts';

export const threads = {} as { [key: number]: ThreadStateType }

const configPath = process.env.CONFIG || 'config.yml'
export let config: ConfigType
export let bot: Telegraf<Context>
let api: OpenAI
let globalTools: ChatToolType[] = []

process.on('uncaughtException', (error, source) => {
  console.log('Uncaught Exception:', error)
  console.log('source:', source)
})

void start()

async function start() {
  // global
  config = readConfig(configPath);
  watchConfigChanges();

  await initFunctions()

  const httpAgent = config.proxyUrl ? new HttpsProxyAgent(`${config.proxyUrl}`) : undefined;

  try {
    api = new OpenAI({
      apiKey: config.auth.chatgpt_api_key,
      httpAgent,
    })

    bot = new Telegraf(config.auth.bot_token)
    log({msg: 'bot started'})

    bot.help(async ctx => ctx.reply('https://github.com/popstas/telegram-functions-bot'))

    await initCommands(bot)

    bot.on([message('text'), editedMessage('text')], onMessage)

    bot.action('add_chat', async (ctx) => {
      const chatId = ctx.chat?.id;
      // @ts-ignore
      const chatName = ctx.chat?.title || `Chat ${chatId}`;
      if (!chatId) return;

      const newChat = {name: chatName, id: chatId} as ConfigChatType;
      config.chats.push(newChat);
      writeConfig(configPath, config);
      await ctx.reply(`Chat added: ${chatName}`);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))
    void bot.launch()
  } catch (e) {
    console.log('restart after 5 seconds...')
    setTimeout(start, 5000)
  }
}

function watchConfigChanges() {
  // global threads, config
  watchFile(configPath, debounce(() => {
    console.log('reload config...')
    config = readConfig(configPath)
    console.log('config:', config)

    config.chats.filter(c => c.id && threads[c.id]).forEach((c) => {
      const id = c.id as number
      threads[id].completionParams = c.completionParams
      threads[id].customSystemMessage = c.systemMessage
    })
  }, 2000))
}

async function initFunctions() {
  readdirSync('src/functions')
    .filter(file => file.endsWith('.ts'))
    .map(async file => {
      const name = file.replace('.ts', '')
      const module = await import(`./functions/${name}`)
      if (typeof module.call !== 'function') {
        return log({msg: `Function ${name} has no call() method`, logLevel: 'warn'})
      }
      globalTools.push({name, module})
    });
}

async function initCommands(bot: Telegraf) {
  bot.command('forget', async ctx => {
    forgetHistory(ctx.chat.id)
    return await sendTelegramMessage(ctx.chat.id, 'OK')
  })

  bot.command('info', async ctx => {
    const {msg, chat}: { msg?: Message.TextMessage, chat?: ConfigChatType } = getCtxChatMsg(ctx);
    if (!chat || !msg) return;
    const answer = getInfoMessage(msg, chat)
    return sendTelegramMessage(ctx.chat.id, answer)
  })

  bot.command('google_auth', async ctx => {
    const {msg, chat}: { msg?: Message.TextMessage, chat?: ConfigChatType } = getCtxChatMsg(ctx);
    if (!chat || !msg) return;
    await commandGoogleOauth(msg)
  });

  await bot.telegram.setMyCommands([
    {
      command: '/forget',
      description: 'Забыть историю сообщений',
    },
    {
      command: '/info',
      description: 'Начальные установки',
    },
    {
      command: '/google_auth',
      description: 'Authenticate with Google',
    },
  ])
}

function getInfoMessage(msg: Message.TextMessage, chatConfig: ConfigChatType) {
  const systemMessage = getSystemMessage(chatConfig)
  const tokens = getTokensCount(chatConfig, systemMessage)

  const lines = [
    `System: ${systemMessage.trim()}`,
    `Tokens: ${tokens}`,
    `Model: ${chatConfig.completionParams.model}`
  ]

  if (chatConfig.chatParams?.forgetTimeout) {
    lines.push(`Forget timeout: ${chatConfig.chatParams.forgetTimeout} sec`)
  }

  if (msg.chat.type === 'private') {
    lines.push(`Настройки приватного режима можно менять:
- Отключать автоудаление сообщений от функций
- Подтверждение на выполнение функций
- Память (когда бот забывает историю сообщений после первого ответа)

Бот понимает эти команды в произвольном виде.`)
  }

  return lines.join('\n\n')
}

async function getChatgptAnswer(msg: Message.TextMessage, chatConfig: ConfigChatType) {
  if (!msg.text) return

  // async function onGptAnswer(msg: Message.TextMessage, res: OpenAI.ChatCompletionMessage) {
  async function onGptAnswer(msg: Message.TextMessage, res: OpenAI.ChatCompletion, level: number = 1): Promise<ToolResponse> {
    // console.log(`onGptAnswer, level ${level}`)
    const messageAgent = res.choices[0]?.message!
    if (messageAgent.tool_calls?.length) {
      const tool_res = await callTools(messageAgent.tool_calls, chatTools, chatConfig, msg);
      if (tool_res) {
        return processToolResponse(tool_res, messageAgent, level);
      }
    }

    const answer = res.choices[0]?.message.content || ''
    addToHistory({msg, answer, systemMessage});

    // forget after tool
    if (thread.messages.find(m => m.role === 'tool')) {
      forgetHistory(msg.chat.id); // TODO: smarter forget
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
      const params = {parse_mode: 'MarkdownV2', deleteAfter: chatConfig.chatParams?.deleteToolAnswers};
      const toolResMessageLimit = 8000;
      const msgContentLimited = toolRes.content.length > toolResMessageLimit ? toolRes.content.slice(0, toolResMessageLimit) + '...' : toolRes.content;
      void sendTelegramMessage(msg.chat.id, msgContentLimited, params);

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

    const res = await api.chat.completions.create({
      messages,
      model: thread.completionParams?.model || 'gpt-4o-mini',
      temperature: thread.completionParams?.temperature,
      // cannot use functions at 3+ level of chaining
      tools: isNoTool ? undefined : tools,
      tool_choice: isNoTool ? undefined : 'auto',
    });

    return await onGptAnswer(msg, res, level + 1);
  }

  const thread = threads[msg.chat?.id || 0]
  let systemMessage = thread?.customSystemMessage || getSystemMessage(chatConfig)
  if (thread?.nextSystemMessage) {
    systemMessage = thread.nextSystemMessage || ''
    thread.nextSystemMessage = ''
  }

  if (msg.chat.type === 'private') {
    if (!chatConfig.functions) chatConfig.functions = []
    chatConfig.functions.push('change_chat_settings')
  }

  const chatTools = chatConfig.functions ?
    chatConfig.functions.map(f => globalTools.find(g => g.name === f) as ChatToolType).filter(Boolean) :
    []

  // prompts from functions, should be after tools
  const prompts = await Promise.all(
    chatTools
      .filter(f => typeof f.module.call(chatConfig, thread).prompt_append === 'function')
      .map(async f => await f.module.call(chatConfig, thread).prompt_append())
      .filter(f => !!f)
  )

  const isTools = chatTools.length > 0;
  const tools = isTools ? chatTools.map(f => f.module.call(chatConfig, thread).functions.toolSpecs).flat() : undefined;

  const date = new Date().toISOString()
  systemMessage = systemMessage.replace(/\{date}/g, date)
  let messages = await buildMessages(systemMessage, thread.messages, chatTools, prompts);

  const res = await api.chat.completions.create({
    messages,
    model: thread.completionParams?.model || 'gpt-4o-mini',
    temperature: thread.completionParams?.temperature,
    // tool_choice: 'required',
    tools,
  });

  return await onGptAnswer(msg, res);
}

async function onMessage(ctx: Context & { secondTry?: boolean }) {
  // console.log("ctx:", ctx);

  const {msg, chat}: {
    msg: Message.TextMessage & { forward_origin?: any } | undefined;
    chat: ConfigChatType | undefined
  } = getCtxChatMsg(ctx);

  if (!msg) {
    console.log('no ctx message detected')
    return
  }

  if (!chat) {
    console.log(`Not in whitelist: `, msg.from)
    const text = `This chat is not in whitelist.\nYour username: ${msg.from?.username}, chat id: ${msg.chat.id}`
    const params = isAdminUser(msg) ? {
      reply_markup: {
        inline_keyboard: [
          [{text: 'Add', callback_data: 'add_chat'}]
        ]
      }
    } : undefined
    return await sendTelegramMessage(msg.chat.id, text, params)
  }

  log({msg: msg.text, logLevel: 'info', chatId: msg.chat.id, role: 'user', username: msg?.from?.username});

  // console.log('chat:', chat)
  const extraMessageParams = {reply_to_message_id: ctx.message?.message_id}

  // TODO: getTelegramUser(msg)
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

  // replace msg.text to button.prompt if match button.name
  let matchedButton: ConfigChatButtonType | undefined = undefined

  // replace msg.text to button.prompt
  const buttons = chat.buttons
  if (buttons) {
    // message == button.name
    matchedButton = buttons.find(b => b.name === msg?.text || '')
    if (matchedButton) {
      msg.text = matchedButton.prompt || ''
    }
  }

  // console.log("ctx.message.text:", ctx.message?.text);
  // addToHistory should be after replace msg.text
  addToHistory({
    msg,
    systemMessage: getSystemMessage(chat),
    completionParams: chat.completionParams,
  })
  // should be after addToHistory
  const thread = threads[msg.chat.id]

  // should be after const thread
  const activeButton = thread?.activeButton
  if (buttons) {
    // message == button.name
    matchedButton = buttons.find(b => b.name === msg?.text || '')
    if (matchedButton) {
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

  // Check previous message time and forget history if time delta exceeds forgetTimeout
  const forgetTimeout = chat.chatParams?.forgetTimeout;
  if (forgetTimeout && thread.msgs.length > 1) {
    const lastMessageTime = new Date(thread.msgs[thread.msgs.length - 2].date * 1000).getTime();
    const currentTime = new Date().getTime();
    const timeDelta = (currentTime - lastMessageTime) / 1000; // in seconds
    if (timeDelta > forgetTimeout) {
      forgetHistory(msg.chat.id);
    }
  }

  // prog system message
  if (chat.progPrefix) {
    const re = new RegExp(`^${chat.progPrefix}`, 'i')
    const isProg = re.test(msg.text)
    if (isProg) {
      thread.customSystemMessage = msg.text.replace(re, '').trim()
      forgetHistory(msg.chat.id)
      if (thread.customSystemMessage === '') {
        return await sendTelegramMessage(msg.chat.id, 'Начальная установка сброшена')
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
async function answerToMessage(ctx: Context & {
  secondTry?: boolean
}, msg: Message.TextMessage, chat: ConfigChatType, extraMessageParams: any) {

  // inject google oauth to thread
  if (config.oauth_google?.client_id || config.auth.google_service_account?.private_key) {
    const authClient = await ensureAuth(msg.from?.id || 0); // for add to threads
    addOauthToThread(authClient, threads, msg);
  }

  try {
    await ctx.persistentChatAction('typing', async () => {
      if (!msg) return
      const res = await getChatgptAnswer(msg, chat)
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

      log({msg: text, logLevel: 'info', chatId: msg.chat.id, role: 'system'});


      const msgSent = await sendTelegramMessage(msg.chat.id, text, extraParams)
      if (msgSent?.chat.id) threads[msgSent.chat.id].msgs.push(msgSent)
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

    return await sendTelegramMessage(msg.chat.id, `${error.message}${ctx.secondTry ? '\n\nПовторная отправка последнего сообщения...' : ''}`, extraMessageParams)
  }
}
