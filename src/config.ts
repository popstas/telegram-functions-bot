import * as yaml from 'js-yaml'
import {readFileSync, writeFileSync, existsSync} from 'fs'
import {ChatParamsType, ConfigChatType, ConfigType, ToolParamsType} from './types.js'
import {log} from "./helpers.ts";

export function readConfig(path?: string): ConfigType {
  if (!path) path = process.env.CONFIG || 'config.yml';
  if (!existsSync(path)) {
    const config = generateConfig()
    writeConfig(path, config)
    console.log('Generated config.yml file, please fill it with your data.')
    return config
  }
  const config = yaml.load(readFileSync(path, 'utf8')) as ConfigType

  if (config.auth.proxy_url === generateConfig().auth.proxy_url) {
    delete (config.auth.proxy_url);
  }

  return config
}

// TODO: write to config.compiled.yml, for preserve config.yml comments
export function writeConfig(path: string = 'config.yml', config: ConfigType): ConfigType {
  try {
    const yamlRaw = yaml.dump(config, {
      lineWidth: -1,
      noCompatMode: true,
      quotingType: '"',
    })
    // console.log('yamlRaw:', yamlRaw)
    writeFileSync(path, yamlRaw);
  } catch (e) {
    console.error('Error in writeConfig(): ', e)
  }
  // const config = yaml.load(readFileSync(path, 'utf8'))
  return config
}

export function generateConfig(): ConfigType {
  return {
    bot_name: 'replace_to_your_bot',
    auth: {
      bot_token: 'replace_to_your_bot_token',
      chatgpt_api_key: 'replace_to_your_chatgpt_api_key',
      proxy_url: 'http://user:pass@host:port',

    },
    adminUsers: ['your_telegram_username'],
    privateUsers: [],
    chats: [{
      name: 'default',
      completionParams: {
        model: 'gpt-4o-mini',
      },
      systemMessage: 'You are using functions to answer the questions. Current date: {date}',
      tools: ['javascript_interpreter', 'brainstorm'],
      chatParams: {
        forgetTimeout: 600,
        deleteToolAnswers: 60,
        confirmation: false,
        showToolMessages: true,
      },
      toolParams: {
        brainstorm: {
          promptBefore: 'Составь только краткий план действий.',
          promptAfter: 'Выше написан краткий план действий. Полный ответ:',
        }
      },
    }],
    http: {
      port: 7586,
      user: 'telegram-bot',
      password: 'your_http_password'
    }
  }
}

export function validateConfig(config: ConfigType) {
  let valid = true
  const gen = generateConfig()
  for (const conf of ['bot_token', 'chatgpt_api_key'] as const) {
    if (!config.auth[conf] || config.auth[conf] === gen.auth[conf]) {
      log({msg: `No auth.${conf} in config`, logLevel: 'error'});
      valid = false
    }
  }
  if (!config.http || !config.http.port || !config.http.user || !config.http.password) {
    log({msg: `Invalid http configuration in config`, logLevel: 'error'});
    valid = false
  }
  return valid
}

export function generatePrivateChatConfig(username: string) {
  return {
    name: `Private ${username}`,
    username,
    toolParams: {} as ToolParamsType,
    chatParams: {} as ChatParamsType,
  } as ConfigChatType;
}

export function logConfigChanges(oldConfig: any, newConfig: any) {
  const oldConfigYaml = yaml.dump(oldConfig, {lineWidth: -1, noCompatMode: true, quotingType: '"'});
  const newConfigYaml = yaml.dump(newConfig, {lineWidth: -1, noCompatMode: true, quotingType: '"'});
  if (oldConfigYaml !== newConfigYaml) {
    const diff = generateDiff(oldConfigYaml, newConfigYaml);
    log({msg: `Config changes:\n${diff}`});
  }
}

function generateDiff(oldStr: string, newStr: string): string {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  const diffLines = [];

  for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
    if (oldLines[i] !== newLines[i]) {
      diffLines.push(`- ${oldLines[i] || ''}`);
      diffLines.push(`+ ${newLines[i] || ''}`);
    }
  }

  return diffLines.join('\n');
}
