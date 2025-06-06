import * as yaml from "js-yaml";
import { readFileSync, writeFileSync, existsSync, watchFile } from "fs";
import {
  ChatParamsType,
  ConfigChatType,
  ConfigType,
  ToolParamsType,
  ButtonsSyncConfigType,
  ConfigChatButtonType,
} from "./types.js";
import { log } from "./helpers.ts";
import { readGoogleSheet } from "./helpers/readGoogleSheet";
import { OAuth2Client } from "google-auth-library/build/src/auth/oauth2client";
import { GoogleAuth } from "google-auth-library";
import debounce from "lodash.debounce";
import { useThreads } from "./threads";

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

  if (config.auth.proxy_url === generateConfig().auth.proxy_url) {
    delete config.auth.proxy_url;
  }

  return config;
}

// TODO: write to config.compiled.yml, for preserve config.yml comments
export function writeConfig(
  path: string | undefined = "config.yml",
  config: ConfigType,
): ConfigType {
  try {
    const yamlRaw = yaml.dump(config, {
      lineWidth: -1,
      noCompatMode: true,
      quotingType: '"',
    });
    // console.log('yamlRaw:', yamlRaw)
    writeFileSync(path, yamlRaw);
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
    stt: {
      whisperBaseUrl: "",
    },
    vision: {
      model: "gpt-4.1-mini",
    },
    models: [],
    chats: [
      {
        name: "default",
        completionParams: {
          model: "gpt-4.1-mini",
        },
        systemMessage:
          "You are using functions to answer the questions. Current date: {date}",
        tools: ["javascript_interpreter", "brainstorm", "fetch"],
        chatParams: {
          forgetTimeout: 600,
          deleteToolAnswers: 60,
          confirmation: false,
          showToolMessages: true,
          showTelegramNames: false,
        },
        toolParams: {
          brainstorm: {
            promptBefore: "Составь только краткий план действий.",
            promptAfter: "Выше написан краткий план действий. Полный ответ:",
          },
        },
      },
    ],
    http: {
      port: 7586,
      telegram_from_username: "second_bot_name",
    },
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

export function logConfigChanges(oldConfig: ConfigType, newConfig: ConfigType) {
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
    log({ msg: `Config changes:\n${diff}` });
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

export async function syncButtons(
  chat: ConfigChatType,
  authClient: OAuth2Client | GoogleAuth,
) {
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
  writeConfig(configPath, config);

  return buttons;
}

export async function getGoogleButtons(
  syncConfig: ButtonsSyncConfigType,
  authClient: OAuth2Client | GoogleAuth,
) {
  const rows = await readGoogleSheet(
    syncConfig.sheetId,
    syncConfig.sheetName,
    authClient,
  );
  if (!rows) {
    console.error(`Failed to load sheet "${syncConfig.sheetId}"`);
    return;
  }

  const buttons: ConfigChatButtonType[] = [];
  for (const row of rows.slice(1) as Array<
    [string, string, number?, string?]
  >) {
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
  watchFile(
    configPath,
    debounce(() => {
      const configOld = useConfig();
      const config = reloadConfig();
      logConfigChanges(configOld, config);

      config.chats
        .filter((c) => c.id && useThreads()[c.id])
        .forEach((c) => {
          const id = c.id as number;
          useThreads()[id].completionParams = c.completionParams;
        });
    }, 2000),
  );
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
