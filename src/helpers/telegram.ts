import {Chat, Message, Update} from "telegraf/types";
import {bot, config} from "../index.ts";
import {ConfigChatButtonType, ConfigChatType} from "../types.ts";
import {Context, Scenes} from "telegraf";
import {User} from "@telegraf/types/manage";
import {log} from "../helpers.ts";

let lastResponse: Message.TextMessage | undefined
let forDelete: Message.TextMessage | undefined

// splits a big message into smaller messages to avoid Telegram API limits
export function splitBigMessage(text: string) {
  const msgs: string[] = []
  const sizeLimit = 4096
  let msg = ''
  for (const line of text.split('\n')) {
    if (msg.length + line.length > sizeLimit) {
      // console.log("split msg:", msg);
      if (msg.trim()) msgs.push(msg)
      msg = ''
    }
    msg += line + '\n'
  }
  if (msg.length > sizeLimit) {
    msg = msg.slice(0, sizeLimit - 3) + '...'
  }
  msgs.push(msg)
  return msgs
}

export async function sendTelegramMessage(chat_id: number, text: string, extraMessageParams?: any): Promise<Message.TextMessage | undefined> {
  return new Promise(async (resolve) => {

    let response: Message.TextMessage | undefined;
    const msgs = splitBigMessage(text)
    // if (msgs.length > 1) console.log(`Split into ${msgs.length} messages`)

    const params = {
      ...extraMessageParams,
      // disable_web_page_preview: true,
      // disable_notification: true,
      // parse_mode: 'HTML'
    }

    for (const msg of msgs) {
      try {
        response = await bot.telegram.sendMessage(chat_id, msg, params)
      } catch (e) {
        // const err = e as { message: string }
        // log({msg: `failover sendTelegramMessage without markdown: ${err.message.slice(512)}`, chatId: chat_id, logLevel: 'warn'})
        const failsafeParams = {reply_markup: params.reply_markup}
        response = await bot.telegram.sendMessage(chat_id, msg, failsafeParams)
        // await bot.telegram.sendMessage(chat_id, `${err.message}`, params)
      }
    }

    // deleteAfter timeout
    if (params.deleteAfter) {
      const deleteAfter = typeof params.deleteAfter === 'number' ? params.deleteAfter * 1000 : 10000;
      if (response) setTimeout(async () => {
        await bot.telegram.deleteMessage(response.chat.id, response.message_id);
      }, deleteAfter);
    }

    if (forDelete) {
      await bot.telegram.deleteMessage(forDelete.chat.id, forDelete.message_id);
      forDelete = undefined
    }

    // deleteAfterNext message
    if (params.deleteAfterNext) {
      // TODO: respect chat_id
      forDelete = response
    }

    lastResponse = response
    resolve(response)
  })
}

export function isAdminUser(msg: Message.TextMessage) {
  return config.adminUsers?.includes(msg.from?.username || '')
}

export function buildButtonRows(buttons: ConfigChatButtonType[]) {
  const buttonRows: { text: string }[][] = [[]]
  buttons.forEach(b => {
    b.row = b.row || 1
    const index = b.row - 1
    buttonRows[index] = buttonRows[index] || []
    buttonRows[index].push({text: b.name})
  })
  return buttonRows
}

function getChatConfig(ctxChat: Chat) {
  let chat = config.chats.find(c => c.id == ctxChat?.id || c.ids?.includes(ctxChat?.id) || 0) || {} as ConfigChatType

  const defaultChat = config.chats.find(c => c.name === 'default')

  if (!chat.id) {
    // console.log("ctxChat:", ctxChat);
    if (ctxChat?.type !== 'private') {
      const chatTitle = (ctxChat as Chat.TitleChat).title
      log({msg: `This is ${ctxChat?.type} chat, not in whitelist: ${ctxChat.title}`, chatId: ctxChat.id, chatTitle, logLevel: 'warn'})
      return
    }

    if (defaultChat) chat = defaultChat

    if (ctxChat?.type === 'private') {
      const privateChat = ctxChat as Chat.PrivateChat
      const username = privateChat.username || 'without_username'
      const isAllowed = config.privateUsers?.includes(username) ||
        config.adminUsers?.includes(username)
      if (!isAllowed) {
        return
      }

      // user chat, with username
      const userChat = config.chats.find(c => c.username === privateChat.username || '')
      if (userChat) chat = userChat
    }
  }

  function mergeConfigParam(name: string, from: any, to: any) {
    if (!from || !from[name]) return
    to[name] = to[name] ? {...from[name], ...to[name]} : from[name]
  }

  mergeConfigParam('completionParams', config, chat);

  if (chat && defaultChat) {
    chat = {...defaultChat, ...chat}
    mergeConfigParam('completionParams', defaultChat, chat);
  }

  return chat
}

export function getActionUserMsg(ctx: Context): {user?: User, msg?: Message} {
  // edited message
  if (ctx.hasOwnProperty('update')) {
    const updateQuery = ctx.update as Update.CallbackQueryUpdate
    const user = updateQuery.callback_query.from
    const msg = updateQuery.callback_query.message
    return {user, msg}
  }
  return {}
}

// return {chat, msg}
export function getCtxChatMsg(ctx: Context) {
  let ctxChat: Chat | undefined
  let msg: Message.TextMessage & { forward_origin?: any } | undefined

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

  if (!ctxChat) {
    console.log('no ctx chat detected')
    return {chat: undefined, msg: undefined}
  }

  const chat = getChatConfig(ctxChat)

  return {chat, msg}
}
