import { aiFunction, AIFunctionsProvider } from '@agentic/core';
import { z } from 'zod';
import { ConfigChatType, ConfigType, ThreadStateType, ToolResponse } from '../types';
import { readConfig } from '../config';
import { readFileSync } from 'fs';

type ToolArgsType = {
  title: string;
};

export const description = 'Read the contents of a JSON file from a URL or local file by titles list'
export const defaultParams = {
  knowledge_json: {
    jsonPath: '/path/to/json',
    jsonUrl: 'or url',
    titleCol: 'title',
    textCol: 'text',
  }
}

let cache: { [path: string]: { data: Object[]; expiry: number } } = {};
function getCache(path: string) {
  const cached = cache[path];
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }
  return null;
}
function setCache(path: string, data: Object[], cacheTime: number) {
  cache[path] = {
    data,
    expiry: Date.now() + cacheTime * 1000,
  };
}

export class KnowledgeJsonClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;

  constructor(configChat: ConfigChatType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
  }

  async read_json() {
    const opts = this?.configChat?.toolParams?.knowledge_json;
    if (!opts) return;
    const jsonPath = opts.jsonPath;
    const jsonUrl = opts.jsonUrl;
    const cacheTime = opts.cacheTime || 3600;
    if (!jsonPath && !jsonUrl) return;

    const path = jsonPath || jsonUrl;
    const cachedData = getCache(path);
    if (cachedData) return cachedData;

    let data;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      const response = await fetch(path);
      data = await response.json();
    } else {
      const fileContent = readFileSync(path, 'utf-8');
      data = JSON.parse(fileContent);
    }

    setCache(path, data, cacheTime);
    return data;
  }

  @aiFunction({
    name: 'read_knowledge_json',
    description,
    inputSchema: z.object({
      title: z.string().describe('Title of the question'),
    }),
  })
  async read_knowledge_json(options: ToolArgsType): Promise<ToolResponse> {
    const title = options.title;

    const data = await this.read_json();
    if (!data) return { content: 'No data available' };
    const opts = this?.configChat?.toolParams?.knowledge_json;
    if (!opts) return { content: 'No config' };
    const titleCol = opts.titleCol || 'title';
    const textCol = opts.textCol || 'text';
    const found = data?.find((row: any) => row[titleCol] === title);
    const content = found ? found[textCol] : `No answer found for ${title}`;
    return { content };
  }

  options_string(str: string) {
    const { title } = JSON.parse(str) as ToolArgsType;
    if (!title) return str;
    return `**JSON data:** \`${title}\``;
  }

  async prompt_append(): Promise<string | undefined> {
    const data = await this.read_json();
    const titleCol = this.configChat.toolParams?.knowledge_json?.titleCol || 'title';
    const titles = data?.map((row: any) => row[titleCol]);
    if (titles) return '## JSON Knowledge base titles:\n' + titles.map((f: string) => `- ${f}`).join('\n');
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new KnowledgeJsonClient(configChat);
}
