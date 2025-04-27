import {Chat, Message, Update} from "telegraf/types";
import {useBot} from "../bot.ts";
import {useConfig} from "../config.ts";
import {ConfigChatButtonType, ConfigChatType} from "../types.ts";
import {Context} from "telegraf";
import {User} from "@telegraf/types/manage";
import {log} from "../helpers.ts";

let lastResponse: Message.TextMessage | undefined
let forDelete: Message.TextMessage | undefined

// splits a big message into smaller messages to avoid Telegram API limits
import telegramifyMarkdown from 'telegramify-markdown';
// Используем telegramifyMarkdown.escapeMarkdownV2 и telegramifyMarkdown.escapeMarkdown для экранирования Markdown-текста

export function splitBigMessage(text: string) {
  const msgs: string[] = []
  const sizeLimit = 4096
  let msg = ''
  for (const origLine of text.split('\n')) {
    const line = origLine.trim()
    if (!line) continue // skip empty or whitespace-only lines
    if (msg.length + line.length + 1 > sizeLimit) { // +1 for the added '\n'
      if (msg.trim()) msgs.push(msg)
      msg = ''
    }
    msg += line + '\n'
  }
  if (msg.length > sizeLimit) {
    msg = msg.slice(0, sizeLimit - 3) + '...'
  }
  if (msg.trim()) msgs.push(msg)
  return msgs
}

export async function sendTelegramMessage(chat_id: number, text: string, extraMessageParams?: any, ctx?: Context, chatConfig?: ConfigChatType): Promise<Message.TextMessage | undefined> {
  return new Promise(async (resolve) => {
    chatConfig = chatConfig || useConfig().chats.find(c => c.bot_name === ctx?.botInfo.username) || {} as ConfigChatType

    let response: Message.TextMessage | undefined;
    const params: any = {
      ...extraMessageParams,
      // disable_web_page_preview: true,
      // disable_notification: true,
      // parse_mode: 'HTML'
    };

    // Автоматически определить режим разметки, если не задан явно
    if (!params.parse_mode) {
      if (text.trim().startsWith('<')) {
        params.parse_mode = 'HTML';
      } else {
        params.parse_mode = 'MarkdownV2';
      }
    }

    // Очистка HTML, если требуется
    function sanitizeTelegramHtml(html: string): string {
      // Заменяем <p> и </p> на двойной перенос строки
      let result = html.replace(/<p[^>]*>/gi, '').replace(/<\/p>/gi, '\n\n');
      // Удаляем <span> и </span>
      result = result.replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '');
      // Все варианты <br>, <br/>, <br /> заменяем на \n
      result = result.replace(/<br\s*\/?>/gi, '\n');
      // Telegram не поддерживает &nbsp; — заменяем на пробел
      result = result.replace(/&nbsp;/gi, ' ');
      // Удаляем лишние пустые строки
      result = result.replace(/\n{3,}/g, '\n\n');
      return result.trim();
    }

    let processedText = text;
    if (params.parse_mode === 'HTML') {
      processedText = sanitizeTelegramHtml(text);
    } else if (params.parse_mode === 'MarkdownV2') {
      // @ts-expect-error: telegramify-markdown типы не совпадают с реальным API
      processedText = telegramifyMarkdown(text, { mode: 'v2' });
    } else if (params.parse_mode === 'Markdown') {
      // @ts-expect-error: telegramify-markdown типы не совпадают с реальным API
      processedText = telegramifyMarkdown(text, { mode: 'classic' });
    }
    const msgs = splitBigMessage(processedText);

    for (const msg of msgs) {
      try {
        response = await useBot(chatConfig.bot_token).telegram.sendMessage(chat_id, msg, params);
      } catch (e: any) {
        // Fallback: if error is 'bot was blocked by the user', handle gracefully
        if (e?.response?.error_code === 403) {
          // Telegram error 403: bot was blocked by the user
          console.warn(`User ${chat_id} blocked the bot. Skipping message.`);
          // Optionally: flag user in DB or take other action
          continue;
        }
        // Fallback to failsafeParams for other errors
        // Previous fallback code:
        // const failsafeParams = { reply_markup: params.reply_markup };
        // response = await useBot(chatConfig.bot_token).telegram.sendMessage(chat_id, msg, failsafeParams);
        const failsafeParams = { reply_markup: params.reply_markup };
        response = await useBot(chatConfig.bot_token).telegram.sendMessage(chat_id, msg, failsafeParams);
      }
    }

    // deleteAfter timeout
    if (params.deleteAfter) {
      const deleteAfter = typeof params.deleteAfter === 'number' ? params.deleteAfter * 1000 : 10000;
      if (response) setTimeout(async () => {
        await useBot(chatConfig?.bot_token).telegram.deleteMessage(response.chat.id, response.message_id);
      }, deleteAfter);
    }

    if (forDelete) {
      await useBot(chatConfig.bot_token).telegram.deleteMessage(forDelete.chat.id, forDelete.message_id);
      forDelete = undefined
    }

    // deleteAfterNext message
    if (params.deleteAfterNext) {
      forDelete = response
    }

    lastResponse = response
    resolve(response)
  })
}

export function isAdminUser(msg: Message.TextMessage) {
  return useConfig().adminUsers?.includes(msg.from?.username || '')
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

function getChatConfig(ctxChat: Chat, ctx: Context) {
  // 1. by chat id
  let chat = useConfig().chats.find(c => c.id == ctxChat?.id || c.ids?.includes(ctxChat?.id) || 0) || {} as ConfigChatType

  const defaultChat = useConfig().chats.find(c => c.name === 'default')

  // 2. by bot_name
  if (!chat.id) {
    chat = useConfig().chats.find(c => c.bot_name === ctx.botInfo.username) || {} as ConfigChatType

    // check access to private chat
    if (chat.id && ctxChat?.type === 'private') {
      const privateChat = ctxChat as Chat.PrivateChat
      const username = privateChat.username || 'without_username'
      const isAllowed = [
        ...(useConfig().privateUsers || []),
        ...(chat.privateUsers || [])].includes(username) || useConfig().adminUsers?.includes(username)
      if (!isAllowed) {
        return
      }
    }
  }

  if (!chat.id) {
    // console.log("ctxChat:", ctxChat);
    if (ctxChat?.type !== 'private') {
      const chatTitle = (ctxChat as Chat.TitleChat).title
      log({msg: `This is ${ctxChat?.type} chat, not in whitelist: ${ctxChat.title}`, chatId: ctxChat.id, chatTitle, logLevel: 'warn'})
      return
    }

    if (defaultChat) chat = defaultChat

    // 2. by username
    if (ctxChat?.type === 'private') {
      // user chat, with username
      const privateChat = ctxChat as Chat.PrivateChat

      // check access
      const username = privateChat.username || 'without_username'
      const isAllowed = useConfig().privateUsers?.includes(username) ||
        useConfig().adminUsers?.includes(username)
      if (!isAllowed) {
        return
      }

      const userChat = useConfig().chats.find(c => c.username === privateChat.username || '')
      if (userChat) chat = userChat
    }
  }

  function mergeConfigParam(name: string, from: any, to: any) {
    if (!from || !from[name]) return
    to[name] = to[name] ? {...from[name], ...to[name]} : from[name]
  }

  mergeConfigParam('completionParams', useConfig(), chat);

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

  const chat = getChatConfig(ctxChat, ctx)

  return {chat, msg}
}

export function getTelegramForwardedUser(msg: Message.TextMessage & { forward_origin?: any }) {
  const forwardOrigin = msg.forward_origin;
  if (!forwardOrigin) return '';

  const username = forwardOrigin?.sender_user?.username;
  const isOurUser = username && useConfig().privateUsers?.includes(username);
  if (isOurUser) return '';

  const name = forwardOrigin.type === 'hidden_user' ?
    forwardOrigin.sender_user_name :
    `${forwardOrigin.sender_user?.first_name ?? ''} ${forwardOrigin.sender_user?.last_name ?? ''}`.trim();

  return `${name}${username ? `, Telegram: @${username}` : ''}`;
}

