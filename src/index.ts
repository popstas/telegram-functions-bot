import {Telegraf, Context, Markup} from 'telegraf'
import {message, editedMessage} from 'telegraf/filters'
import telegramifyMarkdown from 'telegramify-markdown'
import {Chat, Message} from 'telegraf/types'
import OpenAI from 'openai'
import {readdirSync} from 'fs'
import {
  ConfigChatType,
  ConfigChatButtonType, ToolResponse, ChatToolType, ToolParamsType,
} from './types.ts'
import {generatePrivateChatConfig, validateConfig, writeConfig, watchConfigChanges, syncButtons} from './config.ts'
import {HttpsProxyAgent} from "https-proxy-agent"
import {addOauthToThread, commandGoogleOauth, ensureAuth} from "./helpers/google.ts";
import {
  getActionUserMsg,
  getCtxChatMsg,
  isAdminUser,
  sendTelegramMessage
} from "./helpers/telegram.ts";
import {buildMessages, callTools, getSystemMessage, getTokensCount} from "./helpers/gpt.ts";
import {addToHistory, forgetHistory} from "./helpers/history.ts";
import {log, sendToHttp} from './helpers.ts';
import express from 'express';
import { useBot } from './bot';
import { useConfig } from './config';
import { useThreads } from './threads';

export let api: OpenAI
let globalTools: ChatToolType[] = []
let lastCtx = {} as Context

process.on('uncaughtException', (error, source) => {
  console.log('Uncaught Exception:', error)
  console.log('source:', source)
})

void start()

async function start() {
  // global
  const config = useConfig();
  if (!validateConfig(config)) {
    console.log('Invalid config, exiting...')
    process.exit(1)
  }
  watchConfigChanges();

  await initTools()

  const httpAgent = config.auth.proxy_url ? new HttpsProxyAgent(`${config.auth.proxy_url}`) : undefined;

  try {
    api = new OpenAI({
      apiKey: config.auth.chatgpt_api_key,
      httpAgent,
    })

    const bot = useBot();
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
      writeConfig(undefined, config);
      await ctx.reply(`Chat added: ${chatName}`);
    });

    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))
    void bot.launch()

    // Initialize HTTP server
    initHttp();
  } catch (e) {
    console.log('restart after 10 seconds...')
    setTimeout(start, 10000)
  }
}


async function initTools() {
  const files = readdirSync('src/tools').filter(file => file.endsWith('.ts'))
  for (const file of files) {
    const name = file.replace('.ts', '')
    const module = await import(`./tools/${name}`)
    if (typeof module.call !== 'function') {
      log({msg: `Function ${name} has no call() method`, logLevel: 'warn'})
      continue
    }
    globalTools.push({name, module})
  }
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

  bot.command('add_tool', async ctx => {
    const {msg, chat}: { msg?: Message.TextMessage, chat?: ConfigChatType } = getCtxChatMsg(ctx);
    if (!chat || !msg) return;
    await commandAddTool(msg)
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
    {
      command: '/add_tool',
      description: 'Add/edit tool (admins only)',
    },
  ])
}

// add tool to chat config
async function commandAddTool(msg: Message.TextMessage) {
  const excluded = ['change_chat_settings']
  const tools = globalTools.filter(t => !excluded.includes(t.name)).map(t => t.name)
  const toolsInfo = getToolsInfo(tools)
  const text = `Available tools:\n\n${toolsInfo.join('\n\n')}\n\nSelect tool to add:`
  const config = useConfig()

  for (const tool of globalTools) {
    useBot().action(`add_tool_${tool.name}`, async (ctx) => {
      const chatId = ctx.chat?.id;
      if (!chatId) return;

      // check admin
      const {user} = getActionUserMsg(ctx)
      const username = user?.username || 'without_username'
      if (!user || !config.adminUsers?.includes(username)) return;

      let chatConfig: ConfigChatType | undefined;
      if (ctx.chat?.type === 'private') {
        // edit/add private chat
        chatConfig = config.chats.find(chat => username && chat.username === username);
        if (!chatConfig) {
          chatConfig = generatePrivateChatConfig(username);
          config.chats.push(chatConfig);
          // writeConfig(configPath, config)
        }
      } else {
        // edit group chat
        chatConfig = config.chats.find(chat => chat.id === chatId || chat.ids?.includes(chatId));
        if (!chatConfig) {
          void ctx.reply('Chat not found in config');
        }
      }
      if (!chatConfig) return;

      if (!chatConfig.tools) chatConfig.tools = []
      if (!chatConfig.tools.includes(tool.name)) {
        chatConfig.tools.push(tool.name)
      }
      chatConfig.tools = chatConfig.tools.filter(t => !excluded.includes(t))

      if (!chatConfig.toolParams) chatConfig.toolParams = {} as ToolParamsType
      if (tool.module.defaultParams) {
        chatConfig.toolParams = {
          ...tool.module.defaultParams,
          ...chatConfig.toolParams,
        }
      }
      writeConfig(undefined, config);
      await ctx.reply(`Tool added: ${tool.name}${tool.module.defaultParams ? `, with default config: ${JSON.stringify(tool.module.defaultParams)}` : ''}`);
    });
  }

  const buttons = tools.map(t => ([{text: t, callback_data: `add_tool_${t}`}]))
  const params = {reply_markup: {inline_keyboard: buttons}/*, parse_mode: 'MarkdownV2'*/}
  return await sendTelegramMessage(msg.chat.id, text, params)
}

function getToolsInfo(tools: string[]) {
  return tools
    .filter(f => f !== 'change_chat_settings')
    .map(f => globalTools.find(g => g.name === f) as ChatToolType).filter(Boolean)
    .map(f => `- ${f.name}${f.module.description ? ` - ${f.module.description}` : ''}`)
}

function getInfoMessage(msg: Message.TextMessage, chatConfig: ConfigChatType) {
  const systemMessage = getSystemMessage(chatConfig, [])
  const tokens = getTokensCount(chatConfig, systemMessage)

  const lines = [
    `System: ${systemMessage.trim()}`,
    `Tokens: ${tokens}`,
    `Model: ${chatConfig.completionParams.model}`
  ]

  if (chatConfig.id) {
    lines.push(`Config Chat ID: ${chatConfig.id}`)
  }
  if (chatConfig.username) {
    lines.push(`Config is for user: ${chatConfig.username}`)
  }

  if (chatConfig.chatParams?.forgetTimeout) {
    lines.push(`Forget timeout: ${chatConfig.chatParams.forgetTimeout} sec`)
  }

  if (chatConfig.chatParams?.memoryless) {
    lines.push(`Chat is memoryless: it forget history after each tool usage.`)
  }

  if (chatConfig.tools) {
    // f.module.call(chatConfig, thread).functions.toolSpecs - has descriptions too
    const tools = getToolsInfo(chatConfig.tools)
    lines.push(`Tools:\n${tools.join('\n')}`)
  }

  if (msg.chat.type === 'private') {
    lines.push(`Настройки приватного режима можно менять:
- Автоудаление сообщений от функций
- Подтверждение на выполнение функций
- Память (когда бот забывает историю сообщений после первого ответа)
- Время забывания контекста

Бот понимает эти команды в произвольном виде.`)
  }

  return lines.join('\n\n')
}


async function getChatgptAnswer(msg: Message.TextMessage, chatConfig: ConfigChatType, ctx: Context & {
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

  const res = await api.chat.completions.create({
    messages,
    model: thread.completionParams?.model || 'gpt-4o-mini',
    temperature: thread.completionParams?.temperature,
    // tool_choice: 'required',
    tools,
  });

  return await onGptAnswer(msg, res);
}

async function onMessage(ctx: Context & { secondTry?: boolean }, callback?: Function) {
  const threads = useThreads()

  // console.log("ctx:", ctx);
  lastCtx = ctx

  const {msg, chat}: {
    msg: Message.TextMessage & { forward_origin?: any } | undefined;
    chat: ConfigChatType | undefined
  } = getCtxChatMsg(ctx);

  if (!msg) {
    console.log('no ctx message detected')
    return
  }

  // skip replies to other people
  if (msg.reply_to_message && msg.from?.username !== msg.reply_to_message.from?.username) {
    if (msg.reply_to_message.from?.username !== useConfig().bot_name) return
  }

  const chatTitle = (ctx.chat as Chat.TitleChat).title || ''
  const chatId = msg.chat.id

  if (!chat) {
    log({msg: `Not in whitelist, from: ${JSON.stringify(msg.from)}`, chatId, chatTitle, logLevel: 'warn'})
    const text = msg.chat.type === 'private' ?
      `You are not in whitelist. Your username: ${msg.from?.username}` :
      `This chat is not in whitelist.\nYour username: ${msg.from?.username}, chat id: ${msg.chat.id}`
    const params = isAdminUser(msg) ? {
      reply_markup: {
        inline_keyboard: [
          [{text: 'Add', callback_data: 'add_chat'}]
        ]
      }
    } : undefined
    return await sendTelegramMessage(msg.chat.id, text, params)
  }

  // prefix (when defined): answer only to prefixed message
  if (chat.prefix) {
    const re = new RegExp(`^${chat.prefix}`, 'i')
    const isBot = re.test(msg.text)
    if (!isBot) {
      // console.log("not to bot:", ctx.chat);
      return
    }
  }

  log({msg: msg.text, logLevel: 'info', chatId, chatTitle, role: 'user', username: msg?.from?.username});

  // console.log('chat:', chat)
  const extraMessageParams = ctx.message?.message_id ? {reply_to_message_id: ctx.message?.message_id} : {}

  // add "Forwarded from" to message
  // TODO: getTelegramUser(msg)
  const forwardOrigin = msg.forward_origin;
  const username = forwardOrigin?.sender_user?.username
  const isOurUser = username && useConfig().privateUsers?.includes(username)
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
  const msgTextOrig = msg.text || ''
  const buttons = chat.buttonsSynced || chat.buttons
  if (buttons) {
    // message == button.name
    matchedButton = buttons.find(b => b.name === msgTextOrig)
    if (matchedButton) {
      msg.text = matchedButton.prompt || ''
    }
  }

  // console.log("ctx.message.text:", ctx.message?.text);
  // addToHistory should be after replace msg.text
  addToHistory({
    msg,
    completionParams: chat.completionParams,
  })
  // should be after addToHistory
  const thread = threads[msg.chat.id]

  // Check previous message time and forget history if time delta exceeds forgetTimeout
  const forgetTimeout = chat.chatParams?.forgetTimeout;
  if (forgetTimeout && thread.msgs.length > 1) {
    const lastMessageTime = new Date(thread.msgs[thread.msgs.length - 2].date * 1000).getTime();
    const currentTime = new Date().getTime();
    const timeDelta = (currentTime - lastMessageTime) / 1000; // in seconds
    if (timeDelta > forgetTimeout) {
      forgetHistory(msg.chat.id);
      addToHistory({
        msg,
        completionParams: chat.completionParams,
      })
    }
  }

  // activeButton, should be after const thread
  const activeButton = thread?.activeButton
  if (buttons) {
    // message == button.name
    matchedButton = buttons.find(b => b.name === msgTextOrig)
    if (matchedButton) {
      // send ask for text message
      if (matchedButton.waitMessage) {
        thread.activeButton = matchedButton
        return await sendTelegramMessage(msg.chat.id, matchedButton.waitMessage, extraMessageParams)
      }
    }

    // received text, send prompt with text in the end
    if (activeButton) {
      // forgetHistory(msg.chat.id)
      thread.messages = thread.messages.slice(-1);
      thread.nextSystemMessage = activeButton.prompt
      thread.activeButton = undefined
    }
  }

  const historyLength = thread.messages.length
  // return new Promise(async (resolve, reject) => {
  setTimeout(async () => {
    if (thread.messages.length !== historyLength) {
      // skip if new messages added
      return
    }
    const msgSent = await answerToMessage(ctx, msg, chat, extraMessageParams)
    if (typeof callback === 'function') callback(msgSent)
  }, 500)
  // })
}


// send request to chatgpt, answer to telegram
async function answerToMessage(ctx: Context & {
  secondTry?: boolean
}, msg: Message.TextMessage, chat: ConfigChatType, extraMessageParams: any) {

  // inject google oauth to thread
  if (useConfig().auth.oauth_google?.client_id || useConfig().auth.google_service_account?.private_key) {
    const authClient = await ensureAuth(msg.from?.id || 0); // for add to threads
    addOauthToThread(authClient, useThreads(), msg);

    // sync buttons with Google sheet
    if (chat.buttonsSync && msg.text === 'sync' && msg) {
      return await ctx.persistentChatAction('typing', async () => {
        if (!msg) return
        const buttons = await syncButtons(chat, authClient)
        if (!buttons) {
          return void sendTelegramMessage(msg.chat.id, 'Ошибка синхронизации')
        }

        // const buttonRows = buildButtonRows(buttons)
        // const extraParams = {reply_markup: {keyboard: buttonRows, resize_keyboard: true}}
        const extraParams = Markup.keyboard(buttons.map(b => b.name)).resize()
        const answer = 'Готово: ' + buttons.map(b => b.name).join(', ')
        return void sendTelegramMessage(msg.chat.id, answer, extraParams)
      })
    }
  }

  try {
    let msgSent
    await ctx.persistentChatAction('typing', async () => {
      if (!msg) return
      const res = await getChatgptAnswer(msg, chat, ctx)
      let text = res?.content || 'бот не ответил'
      text = telegramifyMarkdown(`${text}`)

      const extraParams: any = {
        ...extraMessageParams,
        ...{parse_mode: 'MarkdownV2'}
      }

      const buttons = chat.buttonsSynced || chat.buttons
      if (buttons) {
        // const buttonRows = buildButtonRows(buttons)
        // extraParams.reply_markup = {keyboard: buttonRows, resize_keyboard: true}
        const extraParamsButtons = Markup.keyboard(buttons.map(b => b.name)).resize()
        Object.assign(extraParams, extraParamsButtons);
      }

      const chatTitle = (msg.chat as Chat.TitleChat).title
      log({msg: text, logLevel: 'info', chatId: msg.chat.id, chatTitle, role: 'system'});


      msgSent = await sendTelegramMessage(msg.chat.id, text, extraParams)
      if (msgSent?.chat.id) useThreads()[msgSent.chat.id].msgs.push(msgSent)
    }) // all done, stops sending typing
    return msgSent
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


function initHttp() {
  // Validate HTTP configuration
  if (!useConfig().http) {
    log({msg: `Invalid http configuration in config, skip http server init`, logLevel: 'warn'});
    return
  }

  const port = useConfig().http.port || 7586;

  // Set up express server
  const app = express();
  app.use(express.json());

  // Add /ping test route
  app.get('/ping', (req, res) => {
    res.send('pong');
  });

  // Add route handler to create a virtual message and call onMessage
  // @ts-ignore
  app.post('/telegram/:chatId', telegramPostHandler);
  // @ts-ignore
  app.get('/telegram/test', telegramPostHandlerTest);

  app.listen(port, () => {
    console.log(`Express server listening on port ${port}`);
  });
}

async function telegramPostHandlerTest(req: express.Request, res: express.Response) {
  req.params = {chatId: "-4534736935"}
  req.body = {text: 'На сервере высокий load average. Проверь, есть ли необычное в процессах, скажи да или нет noconfirm'}
  return telegramPostHandler(req, res)
}

async function telegramPostHandler(req: express.Request, res: express.Response) {
  const {chatId} = req.params;
  const {text} = req.body || '';

  log({msg: `POST /telegram/${chatId}: ${text}`})

  if (!text) {
    return res.status(400).send('Message text is required.');
  }

  const chatConfig = useConfig().chats.find(chat => chat.id === parseInt(chatId));
  if (!chatConfig) {
    log({msg: `http: Chat ${chatId} not found in config`, logLevel: 'warn'});
    return res.status(400).send('Wrong chat_id')
  }

  const chat = {id: parseInt(chatId), title: chatConfig.name}
  const from = {username: useConfig().http.telegram_from_username}
  const virtualCtx = {
    chat,
    update: {
      message: {text, chat, from},
    }
  };

  const ctx = lastCtx as Context & { update: any, chat: any, expressRes?: Express.Response }
  if (!ctx) {
    log({msg: `http: lastCtx not found`, logLevel: 'warn', chatId: chat.id, chatTitle: chat.title});
    return res.status(500).send('lastCtx not found.');
  }

  ctx.update.message = virtualCtx.update.message
  ctx.chat.id = virtualCtx.chat.id
  ctx.chat.title = virtualCtx.chat.title

  try {
    ctx.expressRes = res
    await onMessage(ctx as Context, async (sentMsg: Message.TextMessage) => {
      if (sentMsg) {
        const text = (sentMsg as Message.TextMessage).text;
        res.end(text);
      } else {
        res.status(500).send('Error sending message.');
      }
      // await useBot().telegram.sendMessage(chat.id, 'test - ' + text);
    });
  } catch (error) {
    res.status(500).send('Error sending message.');
  }
}
