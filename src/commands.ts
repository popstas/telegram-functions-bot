import { Telegraf } from "telegraf";
import { Message } from "telegraf/types";
import {
  ConfigChatType,
  ChatToolType,
  ToolParamsType,
  ToolBotType,
} from "./types";
import { generatePrivateChatConfig, useConfig, writeConfig } from "./config";
import { useBot } from "./bot";
import {
  getActionUserMsg,
  getCtxChatMsg,
  sendTelegramMessage,
} from "./helpers/telegram.ts";
import {
  getSystemMessage,
  getTokensCount,
  resolveChatTools,
} from "./helpers/gpt.ts";
import { forgetHistory } from "./helpers/history.ts";
import { commandGoogleOauth } from "./helpers/google.ts";
import useTools from "./helpers/useTools.ts";

export async function initCommands(bot: Telegraf) {
  bot.command("forget", async (ctx) => {
    forgetHistory(ctx.chat.id);
    return await sendTelegramMessage(ctx.chat.id, "OK", undefined, ctx);
  });

  bot.command("info", async (ctx) => {
    const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } =
      getCtxChatMsg(ctx);
    if (!chat || !msg) return;
    const answer = await getInfoMessage(msg, chat);
    return sendTelegramMessage(ctx.chat.id, answer, undefined, ctx);
  });

  bot.command("google_auth", async (ctx) => {
    const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } =
      getCtxChatMsg(ctx);
    if (!chat || !msg) return;
    await commandGoogleOauth(msg);
  });

  bot.command("add_tool", async (ctx) => {
    const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } =
      getCtxChatMsg(ctx);
    if (!chat || !msg) return;
    await commandAddTool(msg, chat);
  });

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
        if (!user || !config.adminUsers?.includes(username)) return;

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
        if (!chatConfig.tools.includes(tool.name)) {
          chatConfig.tools.push(tool.name);
        }
        chatConfig.tools = chatConfig.tools.filter(
          (t) =>
            (typeof t === "object" && "bot_name" in t) || !excluded.includes(t),
        );

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
    const isAgent = typeof t === "object" && "bot_name" in t;
    if (!isAgent) return false;
    const agentConfig = useConfig().chats.find(
      (c) => c.bot_name === t.bot_name,
    );
    if (!agentConfig) return false;

    // check access when privateUsers is set
    if (agentConfig.privateUsers) {
      const isPrivateUser = agentConfig.privateUsers.includes(
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
    `Model: ${chatConfig.model || chatConfig.completionParams.model}`,
  ];

  if (chatConfig.id) {
    lines.push(`Config Chat ID: ${chatConfig.id}`);
  }
  if (chatConfig.username) {
    lines.push(`Config is for user: ${chatConfig.username}`);
  }

  if (chatConfig.chatParams?.forgetTimeout) {
    lines.push(`Forget timeout: ${chatConfig.chatParams.forgetTimeout} sec`);
  }

  if (chatConfig.chatParams?.memoryless) {
    lines.push(`Chat is memoryless: it forget history after each tool usage.`);
  }

  if (chatConfig.tools) {
    const tools = await getToolsInfo(chatConfig.tools, msg);
    lines.push(`Tools:\n${tools.join("\n\n")}`);
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
