import { Telegraf, Context } from "telegraf";
import { Message } from "grammy/types";
import { ConfigChatType, ChatToolType, ToolParamsType, ToolBotType } from "./types.ts";
import { generatePrivateChatConfig, useConfig, writeConfig, readConfig } from "./config.ts";
import { getActionUserMsg, getCtxChatMsg } from "./telegram/context.ts";
import { sendTelegramMessage } from "./telegram/send.ts";
import { getSystemMessage, getTokensCount, resolveChatTools } from "./helpers/gpt.ts";
import { forgetHistory } from "./helpers/history.ts";
import { commandGoogleOauth } from "./helpers/google.ts";
import useTools from "./helpers/useTools.ts";
import { loadSkills, skillToolName } from "./helpers/skills.ts";
import { includesUser } from "./utils/users.ts";

export async function handleForget(ctx: Context) {
  forgetHistory(ctx.chat!.id);
  return await sendTelegramMessage(ctx.chat!.id, "OK", undefined, ctx);
}

export async function handleInfo(ctx: Context) {
  const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } = getCtxChatMsg(ctx);
  if (!chat || !msg) return;
  const answer = await getInfoMessage(msg, chat);
  return sendTelegramMessage(ctx.chat!.id, answer, undefined, ctx);
}

export async function handleGoogleAuth(ctx: Context) {
  const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } = getCtxChatMsg(ctx);
  if (!chat || !msg) return;
  await commandGoogleOauth(msg);
}

export async function handleAddTool(ctx: Context) {
  const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } = getCtxChatMsg(ctx);
  if (!chat || !msg) return;
  await commandAddTool(msg, chat);
}

export async function handleAddSkill(ctx: Context) {
  const { msg, chat }: { msg?: Message.TextMessage; chat?: ConfigChatType } = getCtxChatMsg(ctx);
  if (!chat || !msg) return;
  await commandAddSkill(msg, chat);
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
    (ctx as unknown as { startPayload?: string }).startPayload || msg?.text?.split(" ")[1];
  if (!msg || !chat || !rawPayload) return;

  const config = readConfig();
  let configChat: ConfigChatType | undefined;
  if (chat?.id) {
    configChat = config.chats.find((c) => c.id === chat.id || c.ids?.includes(chat.id!));
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

  bot.command("add_skill", handleAddSkill);

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
    {
      command: "/add_skill",
      description: "Add skill to chat (admins only)",
    },
  ]);
}

const EXCLUDED_TOOLS = ["change_chat_settings", "memory_add", "memory_delete", "memory_search"];

/**
 * Returns `true` when the handler already answered the callback query itself
 * (the Unknown-tool branch), so the caller must not answer it again.
 */
async function handleAddToolAction(ctx: Context, toolName: string): Promise<boolean> {
  const config = useConfig();
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const { user } = getActionUserMsg(ctx);
  const username = user?.username || "without_username";
  if (!user || !includesUser(config.adminUsers, username)) return false;

  const globalTools = await useTools();
  const tool = globalTools.find((t) => t.name === toolName);
  if (!tool) {
    await ctx.answerCbQuery("Unknown tool");
    return true;
  }

  let chatConfig: ConfigChatType | undefined;
  if (ctx.chat?.type === "private") {
    chatConfig = config.chats.find((chat) => username && chat.username === username);
    if (!chatConfig) {
      chatConfig = generatePrivateChatConfig(username);
      config.chats.push(chatConfig);
    }
  } else {
    chatConfig = config.chats.find((chat) => chat.id === chatId || chat.ids?.includes(chatId));
    if (!chatConfig) {
      void ctx.reply("Chat not found in config");
    }
  }
  if (!chatConfig) return false;

  if (!chatConfig.tools) chatConfig.tools = [];
  const hasTool = (chatConfig.tools || []).some((t) => typeof t === "string" && t === tool.name);
  if (!hasTool) chatConfig.tools.push(tool.name);
  chatConfig.tools = chatConfig.tools.filter((t) => {
    if (typeof t === "object" && ("agent_name" in t || "bot_name" in t)) return true;
    return !EXCLUDED_TOOLS.includes(t as string);
  });

  if (!chatConfig.toolParams) chatConfig.toolParams = {} as ToolParamsType;
  if (tool.module.defaultParams) {
    chatConfig.toolParams = { ...tool.module.defaultParams, ...chatConfig.toolParams };
  }
  writeConfig(undefined, config);
  await ctx.reply(
    `Tool added: ${tool.name}${tool.module.defaultParams ? `, with default config: ${JSON.stringify(tool.module.defaultParams)}` : ""}`,
  );
  return false;
}

/**
 * Returns `true` when the handler already answered the callback query itself
 * (the Unknown-skill branch), so the caller must not answer it again.
 */
async function handleAddSkillAction(ctx: Context, toolName: string): Promise<boolean> {
  const config = useConfig();
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  // check admin
  const { user } = getActionUserMsg(ctx);
  const username = user?.username || "without_username";
  if (!user || !includesUser(config.adminUsers, username)) return false;

  const skill = loadSkills().find((s) => skillToolName(s) === toolName);
  if (!skill) {
    await ctx.answerCbQuery("Unknown skill");
    return true;
  }

  let targetChat: ConfigChatType | undefined;
  if (ctx.chat?.type === "private") {
    // edit/add private chat
    targetChat = config.chats.find((chat) => username && chat.username === username);
    if (!targetChat) {
      targetChat = generatePrivateChatConfig(username);
      config.chats.push(targetChat);
    }
  } else {
    // edit group chat
    targetChat = config.chats.find((chat) => chat.id === chatId || chat.ids?.includes(chatId));
    if (!targetChat) {
      void ctx.reply("Chat not found in config");
    }
  }
  if (!targetChat) return false;

  if (!targetChat.tools) targetChat.tools = [];
  const hasTool = (targetChat.tools || []).some((t) => typeof t === "string" && t === toolName);
  if (hasTool) {
    await ctx.reply(`Skill already added: ${toolName}`);
    return false;
  }
  targetChat.tools.push(toolName);
  writeConfig(undefined, config);
  await ctx.reply(`Skill added: ${toolName}`);
  return false;
}

/**
 * Static handler for add_tool_<name>/add_skill_<name> buttons. Registered ONCE
 * per bot at startup (launchBot) instead of one dynamic bot.action() per
 * tool/skill on every /add_tool or /add_skill invocation.
 */
export function registerCommandActions(bot: Telegraf): void {
  bot.action(/^add_tool_(.+)$/, async (ctx) => {
    const answered = await handleAddToolAction(ctx, (ctx.match as RegExpExecArray)[1]);
    if (!answered) await ctx.answerCbQuery();
  });
  bot.action(/^add_skill_(.+)$/, async (ctx) => {
    const answered = await handleAddSkillAction(ctx, (ctx.match as RegExpExecArray)[1]);
    if (!answered) await ctx.answerCbQuery();
  });
}

// add tool to chat config
export async function commandAddTool(msg: Message.TextMessage, chatConfig: ConfigChatType) {
  const config = useConfig();
  // Admin-only (as advertised in setMyCommands): gate before listing tools.
  const requester = msg.from?.username || "without_username";
  if (!includesUser(config.adminUsers, requester)) return;

  const globalTools = await useTools();
  const tools = globalTools.filter((t) => !EXCLUDED_TOOLS.includes(t.name)).map((t) => t.name);
  const toolsInfo = await getToolsInfo(tools, msg);
  const text = `Available tools:\n\n${toolsInfo.join("\n\n")}\n\nSelect tool to add:`;

  const buttons = tools.map((t: string) => [{ text: t, callback_data: `add_tool_${t}` }]);
  const params = { reply_markup: { inline_keyboard: buttons } };
  return await sendTelegramMessage(msg.chat.id, text, params, undefined, chatConfig);
}

// add skill tool to chat config
export async function commandAddSkill(msg: Message.TextMessage, chatConfig: ConfigChatType) {
  const config = useConfig();
  // Admin-only (as advertised in setMyCommands): gate before listing the local
  // skill inventory so non-admins cannot enumerate it.
  const requester = msg.from?.username || "without_username";
  if (!includesUser(config.adminUsers, requester)) return;

  // Drop skills whose name sanitizes to empty or collides with another skill's
  // tool name, mirroring loadSkillTools so the buttons match the runnable tools.
  const seenToolNames = new Set<string>();
  const skills = loadSkills().filter((s) => {
    const toolName = skillToolName(s);
    if (toolName === "skill_" || seenToolNames.has(toolName)) return false;
    seenToolNames.add(toolName);
    return true;
  });
  if (skills.length === 0) {
    return await sendTelegramMessage(
      msg.chat.id,
      "No skills found. Add a skill folder with SKILL.md to the skills directory.",
      undefined,
      undefined,
      chatConfig,
    );
  }

  const skillsInfo = skills
    .map((s) => `- ${skillToolName(s)}${s.description ? ` - ${s.description}` : ""}`)
    .join("\n\n");
  const text = `Available skills:\n\n${skillsInfo}\n\nSelect skill to add:`;

  const buttons = skills.map((s) => {
    const toolName = skillToolName(s);
    return [{ text: toolName, callback_data: `add_skill_${toolName}` }];
  });
  const params = { reply_markup: { inline_keyboard: buttons } };
  return await sendTelegramMessage(msg.chat.id, text, params, undefined, chatConfig);
}

export async function getToolsInfo(tools: (string | ToolBotType)[], msg: Message.TextMessage) {
  const globalTools = await useTools();
  const agentsToolsConfigs = tools.filter((t) => {
    const isAgent = typeof t === "object" && ("agent_name" in t || "bot_name" in t);
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
    .filter(
      (f) =>
        f !== "change_chat_settings" &&
        f !== "memory_add" &&
        f !== "memory_delete" &&
        f !== "memory_search",
    )
    .map((f) => globalTools.find((g) => g.name === f) as ChatToolType)
    .filter(Boolean)
    .map((f) => `- ${f.name}${f.module.description ? ` - ${f.module.description}` : ""}`)
    .concat(agentTools);
}
export async function getInfoMessage(msg: Message.TextMessage, chatConfig: ConfigChatType) {
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
    lines.push(`Streaming: yes (${chatConfig.chatParams.streamMode ?? "edit"} mode)`);
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
