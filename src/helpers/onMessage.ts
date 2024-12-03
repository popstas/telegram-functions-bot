import {Context, Markup} from "telegraf";
import {useThreads} from "../threads.ts";
import {Chat, Message} from "telegraf/types";
import {ConfigChatButtonType, ConfigChatType} from "../types.ts";
import {getCtxChatMsg, getTelegramForwardedUser, isAdminUser, sendTelegramMessage} from "./telegram.ts";
import {syncButtons, useConfig} from "../config.ts";
import {log} from "../helpers.ts";
import {addToHistory, forgetHistory} from "./history.ts";
import {setLastCtx} from "./lastCtx.ts";
import {addOauthToThread, ensureAuth} from "./google.ts";
import {getChatgptAnswer} from "./gpt.ts";
import telegramifyMarkdown from "telegramify-markdown";

export default async function onMessage(ctx: Context & { secondTry?: boolean }, callback?: Function) {
  const threads = useThreads()

  // console.log("ctx:", ctx);
  setLastCtx(ctx);

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
  const forwardedName = getTelegramForwardedUser(msg);
  if (forwardedName) {
    msg.text = `Переслано от: ${forwardedName}\n` + msg.text;
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
