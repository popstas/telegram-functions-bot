import { Telegraf, Context } from "telegraf";
import { Message } from "telegraf/types";
import {
  ConfigChatType,
  ChatToolType,
  ToolParamsType,
  ToolBotType,
} from "./types.ts";
import {
  generatePrivateChatConfig,
  useConfig,
  writeConfig,
  readConfig,
} from "./config.ts";
import { useBot } from "./bot.ts";
import { getActionUserMsg, getCtxChatMsg } from "./telegram/context.ts";
import { sendTelegramMessage } from "./telegram/send.ts";
import {
  getSystemMessage,
  getTokensCount,
  resolveChatTools,
} from "./helpers/gpt.ts";
import { forgetHistory } from "./helpers/history.ts";
import { commandGoogleOauth } from "./helpers/google.ts";
import useTools from "./helpers/useTools.ts";
import { includesUser } from "./utils/users.ts";

export async function handleForget(ctx: Context) {
  forgetHistory(ctx.chat!.id);
  return await sendTelegramMessage(ctx.chat!.id, "OK", undefined, ctx);
}

export async function handleInfo(ctx: Context) {
  const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } =
    getCtxChatMsg(ctx);
  if (!chat || !msg) return;
  const answer = await getInfoMessage(msg, chat);
  return sendTelegramMessage(ctx.chat!.id, answer, undefined, ctx);
}

export async function handleGoogleAuth(ctx: Context) {
  const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } =
    getCtxChatMsg(ctx);
  if (!chat || !msg) return;
  await commandGoogleOauth(msg);
}

export async function handleAddTool(ctx: Context) {
  const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } =
    getCtxChatMsg(ctx);
  if (!chat || !msg) return;
  await commandAddTool(msg, chat);
}

export async function handleAddChat(ctx: Context) {
  const chatId = ctx.chat?.id;
  const chatName = (ctx.chat as { title?: string })?.title || `Chat ${chatId}`;
  if (!chatId) return;

  const config = useConfig();
  const newChat = { name: chatName, id: chatId } as ConfigChatType;
  config.chats.push(newChat);
  writeConfig(undefined, config);
  await ctx.reply(`Chat added: ${chatName}`);
}

export async function handleStart(ctx: Context) {
  const { msg, chat } = getCtxChatMsg(ctx);
  const rawPayload =
    (ctx as unknown as { startPayload?: string }).startPayload ||
    msg?.text?.split(" ")[1];
  if (!msg || !chat || !rawPayload) return;

  const config = readConfig();
  let configChat: ConfigChatType | undefined;
  if (chat?.id) {
    configChat = config.chats.find(
      (c) => c.id === chat.id || c.ids?.includes(chat.id!),
    );
  }
  if (!configChat && chat?.username) {
    configChat = config.chats.find((c) => c.username === chat.username);
  }
  if (!configChat) return;

  const decoded = Buffer.from(rawPayload, "base64").toString();
  const parsedPayload = decoded || rawPayload;
  const [name, value] = parsedPayload.split(":");
  if (!name || !value) return;
  if (!configChat.deeplinks?.some((d) => d.name === name)) return;
  if (!configChat.user_vars) configChat.user_vars = [];
  const username = msg.from?.username;
  if (!username) return;
  let user = configChat.user_vars.find((u) => u.username === username);
  if (!user) {
    user = { username, vars: {} };
    configChat.user_vars.push(user);
  }
  user.vars[name] = value;
  writeConfig(undefined, config);
}

export async function initCommands(bot: Telegraf) {
  bot.start(handleStart);
  bot.command("forget", handleForget);

  bot.command("info", handleInfo);

  bot.command("google_auth", handleGoogleAuth);

  bot.command("add_tool", handleAddTool);

  await bot.telegram.setMyCommands([
    {
      command: "/forget",
      description: "Забыть историю сообщений",
    },
    {
      command: "/info",
      description: "Начальные установки",
    },
    {
      command: "/google_auth",
      description: "Authenticate with Google",
    },
    {
      command: "/add_tool",
      description: "Add/edit tool (admins only)",
    },
  ]);
}

// add tool to chat config
export async function commandAddTool(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
) {
  const excluded = ["change_chat_settings"];
  const globalTools = await useTools();
  const tools = globalTools
    .filter((t) => !excluded.includes(t.name))
    .map((t) => t.name);
  const toolsInfo = await getToolsInfo(tools, msg);
  const text = `Available tools:\n\n${toolsInfo.join("\n\n")}\n\nSelect tool to add:`;
  const config = useConfig();

  for (const tool of globalTools) {
    useBot(chatConfig.bot_token!).action(
      `add_tool_${tool.name}`,
      async (ctx) => {
        const chatId = ctx.chat?.id;
        if (!chatId) return;

        // check admin
        const { user } = getActionUserMsg(ctx);
        const username = user?.username || "without_username";
        if (!user || !includesUser(config.adminUsers, username)) return;

        let chatConfig: ConfigChatType | undefined;
        if (ctx.chat?.type === "private") {
          // edit/add private chat
          chatConfig = config.chats.find(
            (chat) => username && chat.username === username,
          );
          if (!chatConfig) {
            chatConfig = generatePrivateChatConfig(username);
            config.chats.push(chatConfig);
          }
        } else {
          // edit group chat
          chatConfig = config.chats.find(
            (chat) => chat.id === chatId || chat.ids?.includes(chatId),
          );
          if (!chatConfig) {
            void ctx.reply("Chat not found in config");
          }
        }
        if (!chatConfig) return;

        if (!chatConfig.tools) chatConfig.tools = [];
        const hasTool = (chatConfig.tools || []).some(
          (t) => typeof t === "string" && t === tool.name,
        );
        if (!hasTool) {
          chatConfig.tools.push(tool.name);
        }
        chatConfig.tools = chatConfig.tools.filter((t) => {
          if (typeof t === "object" && ("agent_name" in t || "bot_name" in t)) {
            return true;
          }
          return !excluded.includes(t as string);
        });

        if (!chatConfig.toolParams)
          chatConfig.toolParams = {} as ToolParamsType;
        if (tool.module.defaultParams) {
          chatConfig.toolParams = {
            ...tool.module.defaultParams,
            ...chatConfig.toolParams,
          };
        }
        writeConfig(undefined, config);
        await ctx.reply(
          `Tool added: ${tool.name}${tool.module.defaultParams ? `, with default config: ${JSON.stringify(tool.module.defaultParams)}` : ""}`,
        );
      },
    );
  }

  const buttons = tools.map((t: string) => [
    { text: t, callback_data: `add_tool_${t}` },
  ]);
  const params = { reply_markup: { inline_keyboard: buttons } };
  return await sendTelegramMessage(
    msg.chat.id,
    text,
    params,
    undefined,
    chatConfig,
  );
}

export async function getToolsInfo(
  tools: (string | ToolBotType)[],
  msg: Message.TextMessage,
) {
  const globalTools = await useTools();
  const agentsToolsConfigs = tools.filter((t) => {
    const isAgent =
      typeof t === "object" && ("agent_name" in t || "bot_name" in t);
    if (!isAgent) return false;
    const agentConfig = useConfig().chats.find(
      (c) => c.agent_name === t.agent_name || c.bot_name === t.bot_name,
    );
    if (!agentConfig) return false;

    // check access when privateUsers is set
    if (agentConfig.privateUsers) {
      const isPrivateUser = includesUser(
        agentConfig.privateUsers,
        msg.from?.username || "without_username",
      );
      if (!isPrivateUser) return false;
    }

    return true;
  }) as ToolBotType[];
  const agentTools = agentsToolsConfigs.map((f: ToolBotType) => {
    return `- ${f.name}${f.description ? ` - ${f.description}` : ""}`;
  });
  return tools
    .filter((f) => f !== "change_chat_settings")
    .map((f) => globalTools.find((g) => g.name === f) as ChatToolType)
    .filter(Boolean)
    .map(
      (f) =>
        `- ${f.name}${f.module.description ? ` - ${f.module.description}` : ""}`,
    )
    .concat(agentTools);
}
export async function getInfoMessage(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
) {
  const chatTools = await resolveChatTools(msg, chatConfig);
  const systemMessage = await getSystemMessage(chatConfig, chatTools);
  const tokens = getTokensCount(chatConfig, systemMessage);

  const lines = [
    `System: ${systemMessage.trim()}`,
    `Tokens: ${tokens}`,
    `Model: ${chatConfig.local_model || chatConfig.completionParams.model}`,
  ];

  if (chatConfig.id) {
    lines.push(`Config Chat ID: ${chatConfig.id}`);
  }
  if (chatConfig.username) {
    lines.push(`Config is for user: ${chatConfig.username}`);
  }
  if (chatConfig.prefix) {
    lines.push(`Prefix: ${chatConfig.prefix}`);
  }

  if (chatConfig.chatParams?.forgetTimeout) {
    lines.push(`Forget timeout: ${chatConfig.chatParams.forgetTimeout} sec`);
  }

  if (chatConfig.chatParams?.memoryless) {
    lines.push(`Chat is memoryless: it forget history after each tool usage.`);
  }

  if (chatConfig.tools && chatConfig.tools.length > 0) {
    const tools = await getToolsInfo(chatConfig.tools, msg);
    lines.push(`\nTools:\n${tools.join("\n\n")}`);
  }

  if (chatConfig.chatParams?.streaming) {
    lines.push("Streaming: yes");
  }

  if (chatConfig.chatParams?.useResponsesApi && !chatConfig.local_model) {
    lines.push("Responses API: yes");
  }

  if (msg.chat.type === "private") {
    lines.push(`Настройки приватного режима можно менять:
- Автоудаление сообщений от функций
- Подтверждение на выполнение функций
- Память (когда бот забывает историю сообщений после первого ответа)
- Время забывания контекста

Бот понимает эти команды в произвольном виде.`);
  }

  return lines.join("\n\n");
}
