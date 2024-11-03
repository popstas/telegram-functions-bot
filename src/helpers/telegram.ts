import {Chat, Message, Update} from "telegraf/types";
import {bot, config} from "../index.ts";
import {ConfigChatButtonType, ConfigChatType} from "../types.ts";
import {Context} from "telegraf";

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
    msg = msg.slice(0, sizeLimit)
  }
  msgs.push(msg)
  return msgs
}

export async function sendTelegramMessage(chat_id: number, text: string, extraMessageParams?: any): Promise<Message.TextMessage | undefined> {
  return new Promise(async (resolve) => {

    let response: Message.TextMessage | undefined;
    const msgs = splitBigMessage(text)
    if (msgs.length > 1) console.log(`Split into ${msgs.length} messages`)

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
        console.log('failover sendTelegramMessage without markdown')
        const failsafeParams = {reply_markup: params.reply_markup}
        response = await bot.telegram.sendMessage(chat_id, msg, failsafeParams)
        // await bot.telegram.sendMessage(chat_id, `${err.message}`, params)
      }
    }

    // deleteAfter timeout
    if (params.deleteAfter) {
      const deleteAfter = typeof params.deleteAfter === 'number' ? params.deleteAfter : 10000;
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
      console.log(`This is ${ctxChat?.type} chat, not in whitelist: ${ctxChat.id}`)
      return
    }

    if (defaultChat) chat = defaultChat

    if (ctxChat?.type === 'private') {
      const privateChat = ctxChat as Chat.PrivateChat
      const isAllowed = config.allowedPrivateUsers?.includes(privateChat.username || '')
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

