import {readdirSync} from 'fs'
import {Telegraf} from 'telegraf'
import {Message} from 'telegraf/types'
import {ConfigChatType, ConfigChatButtonType, ChatToolType, ToolParamsType} from './types'
import {useConfig} from './config'
import {useBot} from './bot'
import {getCtxChatMsg, isAdminUser, sendTelegramMessage} from './helpers/telegram'
import {getSystemMessage, getTokensCount} from './helpers/gpt'
import {log} from './helpers'

export async function initTools() {
  const files = readdirSync('src/tools').filter(file => file.endsWith('.ts'))
  const globalTools: ChatToolType[] = []
  
  for (const file of files) {
    const name = file.replace('.ts', '')
    const module = await import(`./tools/${name}`)
    if (typeof module.call !== 'function') {
      log({msg: `Function ${name} has no call() method`, logLevel: 'warn'})
      continue
    }
    globalTools.push({name, module})
  }
  return globalTools
}

export async function initCommands(bot: Telegraf) {
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
export async function commandAddTool(msg: Message.TextMessage) {
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
  const params = {reply_markup: {inline_keyboard: buttons}}
  return await sendTelegramMessage(msg.chat.id, text, params)
}

export function getToolsInfo(tools: string[]) {
  return tools
    .filter(f => f !== 'change_chat_settings')
    .map(f => globalTools.find(g => g.name === f) as ChatToolType).filter(Boolean)
    .map(f => `- ${f.name}${f.module.description ? ` - ${f.module.description}` : ''}`)
}

export function getInfoMessage(msg: Message.TextMessage, chatConfig: ConfigChatType) {
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
