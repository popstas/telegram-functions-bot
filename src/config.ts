import * as yaml from "js-yaml";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  watchFile,
  watch,
  readdirSync,
  mkdirSync,
} from "fs";
import path from "path";
import {
  ChatParamsType,
  ConfigChatType,
  ConfigType,
  ToolParamsType,
  ButtonsSyncConfigType,
  ConfigChatButtonType,
} from "./types.ts";
import { log, safeFilename } from "./helpers.ts";
import { readGoogleSheet } from "./helpers/readGoogleSheet.ts";
import { OAuth2Client, GoogleAuth } from "google-auth-library";
import debounce from "lodash.debounce";
import { useThreads } from "./threads.ts";

function writeFileIfChanged(path: string, content: string) {
  try {
    if (existsSync(path)) {
      const old = readFileSync(path, "utf8");
      if (old === content) return;
    }
    writeFileSync(path, content);
  } catch (e) {
    console.error("writeFileIfChanged error:", e);
  }
}

export function loadChatsFromDir(dir: string): ConfigChatType[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  const chats: ConfigChatType[] = [];
  for (const file of files) {
    const content = readFileSync(path.join(dir, file), "utf8");
    const chat = yaml.load(content) as ConfigChatType;
    chats.push(chat);
  }
  return chats;
}

export function saveChatsToDir(dir: string, chats: ConfigChatType[]) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  chats.forEach((chat) => {
    const nameForFile = chat.username ? `private_${chat.username}` : `${chat.name || chat.id}`;
    const safe = safeFilename(nameForFile, `${chat.id || 0}`);
    const filePath = path.join(dir, `${safe}.yml`);
    const yamlRaw = yaml.dump(chat, {
      lineWidth: -1,
      noCompatMode: true,
      quotingType: '"',
    });
    writeFileIfChanged(filePath, yamlRaw);
  });
}

export function writeChatConfig(chat: ConfigChatType) {
  const config = useConfig();
  const dir = config.chatsDir || "data/chats";
  saveChatsToDir(dir, [chat]);
}

export function convertChatConfig(mode: "split" | "merge") {
  const cfg = readConfig(configPath);
  const dir = cfg.chatsDir || "data/chats";

  if (mode === "split") {
    cfg.useChatsDir = true;
    cfg.chatsDir = dir;
  } else {
    cfg.chats = loadChatsFromDir(dir);
    cfg.useChatsDir = false;
  }

  writeConfig(configPath, cfg);
  return cfg;
}

export function readConfig(path?: string): ConfigType {
  if (!path) path = process.env.CONFIG || "config.yml";
  if (!existsSync(path)) {
    const config = generateConfig();
    writeConfig(path, config);
    if (process.env.NODE_ENV !== "test") {
      console.log("Generated config.yml file, please fill it with your data.");
    }
    return config;
  }
  const config = yaml.load(readFileSync(path, "utf8")) as ConfigType;

  if (config.useChatsDir) {
    const dir = config.chatsDir || "data/chats";
    config.chats = loadChatsFromDir(dir);
  }

  if (config.auth.proxy_url === generateConfig().auth.proxy_url) {
    delete config.auth.proxy_url;
  }

  // auto-generate agent_name when missing
  let configModified = false;
  config.chats = config.chats.map((chat, idx) => {
    if (chat.name === "default") return chat; // skip default
    if (chat.username) return chat; // skip private chats
    if (chat.agent_name) return chat; // skip if already set

    const base = chat.bot_name?.replace(/_bot$/i, "") || chat.name;
    const gen = base.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const agent_name = gen || `agent_${idx}`;
    configModified = true;

    log({
      msg: `agent_name not set for chat ${chat.name}, generated ${agent_name}`,
      logLevel: "warn",
    });

    return { ...chat, agent_name };
  });

  if (configModified) {
    log({ msg: "Config modified" });
    // writeConfig(path, config);
  }
  checkConfigSchema(config);
  return config;
}

// TODO: write to config.compiled.yml, for preserve config.yml comments
export function writeConfig(
  path: string | undefined = "config.yml",
  config: ConfigType,
): ConfigType {
  try {
    let cfgToSave: ConfigType | Omit<ConfigType, "chats"> = config;
    if (config.useChatsDir) {
      const dir = config.chatsDir || "data/chats";
      saveChatsToDir(dir, config.chats);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { chats, ...rest } = config;
      cfgToSave = rest;
    }
    const yamlRaw = yaml.dump(cfgToSave, {
      lineWidth: -1,
      noCompatMode: true,
      quotingType: '"',
    });
    // console.log('yamlRaw:', yamlRaw)
    writeFileIfChanged(path, yamlRaw);
  } catch (e) {
    console.error("Error in writeConfig(): ", e);
  }
  // const config = yaml.load(readFileSync(path, 'utf8'))
  return config;
}

export function generateConfig(): ConfigType {
  return {
    bot_name: "replace_to_your_bot",
    auth: {
      bot_token: "replace_to_your_bot_token",
      chatgpt_api_key: "replace_to_your_chatgpt_api_key",
      proxy_url: "http://user:pass@host:port",
    },
    adminUsers: ["your_telegram_username"],
    privateUsers: [],
    mcpServers: {
      fetch: {
        command: "uvx",
        args: ["mcp-server-fetch"],
      },
    },
    local_models: [],
    http: {
      port: 7586,
      telegram_from_username: "second_bot_name",
      http_token: "change_me",
    },
    mqtt: {
      host: "localhost",
      port: 1883,
      base: "bots/",
    },
    stt: {
      whisperBaseUrl: "",
    },
    vision: {
      model: "gpt-4.1-mini",
    },
    logLevel: "info",
    langfuse: {
      secretKey: "",
      publicKey: "",
      baseUrl: "",
    },
    useChatsDir: false,
    chatsDir: "data/chats",
    chats: [
      {
        name: "default",
        agent_name: "default",
        completionParams: {
          model: "gpt-4.1-mini",
        },
        systemMessage: "You are using functions to answer the questions. Current date: {date}",
        tools: ["javascript_interpreter", "brainstorm", "fetch"],
        responsesParams: {
          reasoning: { effort: "minimal" },
          text: { verbosity: "low" },
        },
        chatParams: {
          forgetTimeout: 600,
          deleteToolAnswers: 60,
          confirmation: false,
          historyLimit: 20,
          showToolMessages: true,
          useResponsesApi: false,
          streaming: false,
          responseButtons: false,
          vector_memory: false,
        },
        toolParams: {
          brainstorm: {
            promptBefore: "Составь только краткий план действий.",
            promptAfter: "Выше написан краткий план действий. Полный ответ:",
          },
          vector_memory: {
            dbPath: "data/memory/default.sqlite",
            dimension: 1536,
            alwaysSearch: false,
            deleteMaxDistance: 1.1,
          },
        },
      },
      {
        name: "full-example",
        description: "Agent's description",
        bot_token: "",
        bot_name: "telegram_bot_name",
        agent_name: "full-example",
        privateUsers: [],
        id: 123456789,
        ids: [123456789],
        username: "telegram_username_for_private_chats",
        prefix: "бот",
        completionParams: {
          model: "gpt-4.1-mini",
          temperature: 0.7,
        },
        local_model: "",
        response_format: { type: "json_object" },
        systemMessage: "You are using functions to answer the questions. Current date: {date}",
        buttons: [{ name: "button_name", prompt: "button_prompt" }],
        buttonsSync: {
          sheetId: "sheet_id",
          sheetName: "sheet_name",
        },
        buttonsSynced: [{ name: "button_name", prompt: "button_prompt" }],
        deeplinks: [{ name: "from" }],
        user_vars: [
          {
            username: "myuser",
            vars: { from: "popstas" },
          },
        ],
        http_token: "change_me",
        tools: ["javascript_interpreter", "brainstorm", "fetch"],
        evaluators: [{ agent_name: "evaluator", threshold: 4, maxIterations: 2 }],
        responsesParams: {
          reasoning: { effort: "minimal" },
          text: { verbosity: "low" },
        },
        chatParams: {
          forgetTimeout: 600,
          deleteToolAnswers: 60,
          confirmation: false,
          historyLimit: 20,
          showToolMessages: true,
          useResponsesApi: false,
          streaming: false,
          responseButtons: false,
          vector_memory: false,
        },
        toolParams: {
          brainstorm: {
            promptBefore: "Составь только краткий план действий.",
            promptAfter: "Выше написан краткий план действий. Полный ответ:",
          },
          vector_memory: {
            dbPath: "data/memory/default.sqlite",
            dimension: 1536,
            alwaysSearch: false,
            deleteMaxDistance: 1.1,
          },
        },
      },
    ],
  };
}

export function validateConfig(config: ConfigType) {
  let valid = true;
  const gen = generateConfig();
  for (const conf of ["bot_token", "chatgpt_api_key"] as const) {
    if (!config.auth[conf] || config.auth[conf] === gen.auth[conf]) {
      const msg = `No auth.${conf} in config`;
      log({ msg, logLevel: "error" });
      valid = false;
    }
  }
  return valid;
}

export function generatePrivateChatConfig(username: string) {
  return {
    name: `Private ${username}`,
    username,
    toolParams: {} as ToolParamsType,
    chatParams: {} as ChatParamsType,
  } as ConfigChatType;
}

export function updateChatInConfig(chatConfig: ConfigChatType) {
  const config = useConfig();
  let idx = -1;
  if (chatConfig.id) {
    idx = config.chats.findIndex((c) => c.id === chatConfig.id || c.ids?.includes(chatConfig.id!));
  }
  if (idx === -1 && chatConfig.username) {
    idx = config.chats.findIndex((c) => c.username === chatConfig.username);
  }
  if (idx === -1) {
    idx = config.chats.findIndex((c) => c.name === chatConfig.name);
  }
  if (idx === -1) {
    throw new Error("Chat not found in config");
  }
  config.chats[idx] = chatConfig;
  if (config.useChatsDir) {
    writeChatConfig(chatConfig);
    writeConfig(configPath, { ...config, chats: [] });
  } else {
    writeConfig(configPath, config);
  }
}

export function checkConfigSchema(config: ConfigType) {
  // check root
  const rootKeys = Object.keys(generateConfig()) as Array<keyof ConfigType>;
  const checkKeys = (obj: Record<string, unknown>, allowed: string[], path = "") => {
    Object.keys(obj).forEach((k) => {
      if (!allowed.includes(k)) {
        let target = path;
        if (path.startsWith("chats[")) {
          const chatName = obj.name;
          target = `chats[${chatName}]`;
        }
        log({
          msg: `Unexpected field ${target}.${k} in config.yml`,
          logLevel: "warn",
        });
      }
    });
  };
  checkKeys(config as unknown as Record<string, unknown>, rootKeys);
  config.local_models?.forEach((m, idx) =>
    checkKeys(m as Record<string, unknown>, ["name", "url", "model"], `local_models[${idx}].`),
  );

  // check chats
  const exampleChat = generateConfig().chats.find(
    (c) => c.name === "full-example",
  ) as ConfigChatType;
  const chatKeys = Object.keys(exampleChat) as Array<keyof ConfigChatType>;
  config.chats.forEach((c, idx) => {
    checkKeys(c as Record<string, unknown>, chatKeys, `chats[${idx}].`);
    if (c.chatParams && "showTelegramNames" in (c.chatParams as Record<string, unknown>)) {
      log({
        msg: `chats[${c.name || idx}].chatParams.showTelegramNames is deprecated`,
        logLevel: "warn",
      });
    }
  });
}

export function logConfigChanges(oldConfig: ConfigType, newConfig: ConfigType, file?: string) {
  const filename = file || configPath;

  if (oldConfig.useChatsDir || newConfig.useChatsDir) {
    const oldChats = oldConfig.chats || [];
    const newChats = newConfig.chats || [];
    const names = new Set<unknown>();
    oldChats.forEach((c) => names.add(c.name || c.id));
    newChats.forEach((c) => names.add(c.name || c.id));
    let fullDiff = "";
    names.forEach((name) => {
      const oldChat = oldChats.find((c) => (c.name || c.id) === name);
      const newChat = newChats.find((c) => (c.name || c.id) === name);
      const oldYaml = yaml.dump(oldChat || {}, {
        lineWidth: -1,
        noCompatMode: true,
        quotingType: '"',
      });
      const newYaml = yaml.dump(newChat || {}, {
        lineWidth: -1,
        noCompatMode: true,
        quotingType: '"',
      });
      if (oldYaml !== newYaml) {
        fullDiff += `# ${name}\n${generateDiff(oldYaml, newYaml)}\n`;
      }
    });
    if (fullDiff) {
      log({ msg: `Config changes in ${filename}:\n${fullDiff}` });
      writeFileSync("data/last-config-change.diff", fullDiff);
    }
    return;
  }

  const oldConfigYaml = yaml.dump(oldConfig, {
    lineWidth: -1,
    noCompatMode: true,
    quotingType: '"',
  });
  const newConfigYaml = yaml.dump(newConfig, {
    lineWidth: -1,
    noCompatMode: true,
    quotingType: '"',
  });
  if (oldConfigYaml !== newConfigYaml) {
    const diff = generateDiff(oldConfigYaml, newConfigYaml);
    log({ msg: `Config changes in ${filename}:\n${diff}` });
    writeFileSync("data/last-config-change.diff", diff);
  }
}

function generateDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const diffLines = [];

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      diffLines.push(`- ${oldLines[i] || ""}`);
      diffLines.push(`+ ${newLines[i] || ""}`);
    }
  }

  return diffLines.join("\n");
}

let configPath = process.env.CONFIG || "config.yml";
export function setConfigPath(path: string) {
  configPath = path;
}

export async function syncButtons(chat: ConfigChatType, authClient: OAuth2Client | GoogleAuth) {
  const syncConfig = chat.buttonsSync || {
    sheetId: "1TCtetO2kEsV7_yaLMej0GCR3lmDMg9nVRyRr82KT5EE",
    sheetName: "gpt prompts all private chats",
  };
  const buttons = await getGoogleButtons(syncConfig, authClient);
  if (!buttons) return;

  chat.buttonsSynced = buttons;

  const config = useConfig();
  const chatIndex = config.chats.findIndex((c) => c.name === chat.name);

  config.chats[chatIndex] = chat;
  if (config.useChatsDir) {
    writeChatConfig(chat);
    writeConfig(configPath, { ...config, chats: [] });
  } else {
    writeConfig(configPath, config);
  }

  return buttons;
}

export async function getGoogleButtons(
  syncConfig: ButtonsSyncConfigType,
  authClient: OAuth2Client | GoogleAuth,
) {
  const rows = await readGoogleSheet(syncConfig.sheetId, syncConfig.sheetName, authClient);
  if (!rows) {
    console.error(`Failed to load sheet "${syncConfig.sheetId}"`);
    return;
  }

  const buttons: ConfigChatButtonType[] = [];
  for (const row of rows.slice(1) as Array<[string, string, number?, string?]>) {
    const button: ConfigChatButtonType = {
      name: row[0],
      prompt: row[1],
      row: row[2],
      waitMessage: row[3],
    };
    if (button.name.startsWith("#")) continue;
    buttons.push(button);
  }
  return buttons;
}

export function watchConfigChanges() {
  const handler = debounce((file?: string) => {
    const configOld = useConfig();
    const config = reloadConfig();
    logConfigChanges(configOld, config, file);

    config.chats
      .filter((c) => c.id && useThreads()[c.id])
      .forEach((c) => {
        const id = c.id as number;
        useThreads()[id].completionParams = c.completionParams;
      });
  }, 2000);

  watchFile(configPath, () => handler(configPath));

  const cfg = useConfig();
  if (cfg.useChatsDir) {
    const dir = cfg.chatsDir || "data/chats";
    if (existsSync(dir)) {
      const watchChat = (f: string) =>
        watchFile(path.join(dir, f), () => handler(path.join(dir, f)));

      readdirSync(dir)
        .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
        .forEach(watchChat);

      watch(dir, (event, filename) => {
        if (!filename) return;
        if (!filename.toString().match(/\.ya?ml$/i)) return;
        const file = filename.toString();
        const full = path.join(dir, file);
        if (event === "rename" && existsSync(full)) {
          watchChat(file);
          handler(full);
        }
      });
    }
  }
}

let config = {} as ConfigType;
export function useConfig(): ConfigType {
  if (!config?.auth?.bot_token) reloadConfig();
  return config;
}
export function reloadConfig(): ConfigType {
  config = readConfig();
  return config;
}
