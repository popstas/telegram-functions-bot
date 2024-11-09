import {
  aiFunction,
  AIFunctionsProvider,
} from '@agentic/core'
import defaultKy, {type KyInstance} from 'ky'
import {z} from 'zod'
import {readConfig} from '../config.ts'
import {ConfigChatType, ConfigType, ThreadStateType, ToolResponse} from "../types.ts";
import * as fs from "node:fs";
import * as yaml from 'js-yaml'

type TaskArgsType = {
  clientName: string,
  phone: string,
  email: string,
  telegram: string,
  referrer: string,
  description: string
}

type TaskBodyType = {
  name: string,
  description: string,
  template?: {
    id: string
  }
}

export const description = 'Creates new task in CRM Planfix.'
export const defaultParams = {
  planfix: {
    account: 'your_account',
    token: 'rest_api_token',
  },
  planfix_create_request_task: {
    name: 'New task for {clientName}',
    templateId: 0,
  }
} as { planfix: { account: string, token: string }, planfix_create_request_task: { name: string, templateId: number } }

export class PlanfixCreateTaskClient extends AIFunctionsProvider {
  protected readonly ky: KyInstance
  protected readonly config: ConfigType
  protected readonly configChat: ConfigChatType
  protected readonly thread: ThreadStateType

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super()

    this.config = readConfig();
    this.configChat = configChat
    this.thread = thread

    this.ky = defaultKy.extend({
      prefixUrl: `https://${this.configChat.toolParams.planfix?.account}.planfix.com/rest/`,
      headers: {
        Authorization: `Bearer ${this.configChat.toolParams.planfix?.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
    })
  }

  @aiFunction({
    name: 'planfix_create_request_task',
    description,
    inputSchema: z.object({
      clientName: z
        .string()
        .describe(
          'Name of client. Example: "Maria"'
        ),
      phone: z
        .string()
        .describe(
          'Phone. Example: "+79222222222"'
        ),
      email: z
        .string()
        .describe(
          'Email. Example: "me@gmail.com"'
        ),
      telegram: z
        .string()
        .describe(
          'Telegram login. Example: "@maria"'
        ),
      referrer: z
        .string()
        .describe(
          'Рекомендатель. Пример: "Иван Петров"'
        ),
      description: z
        .string()
        .describe(
          'Description of the task. Example: "Call Maria to discuss new project"'
        )
    })
  })
  async planfix_create_request_task(options: TaskArgsType): Promise<ToolResponse> {
    const conf = this.configChat.toolParams.planfix_create_request_task
    if (!conf) return {
      content: 'No config'
    }

    // add contacts to description
    const contactsMap = [
      ['Имя', 'clientName'],
      ['Телефон', 'phone'],
      ['Email', 'email'],
      ['Telegram', 'telegram'],
      ['Рекомендатель', 'referrer'],
    ];
    const contacts = []
    for (const [label, key] of contactsMap) {
      const value = options[key as keyof TaskArgsType]
      if (value) contacts.push(`${label}: ${value}`)
    }
    options.description = contacts.join('\n') + '\n\n' + options.description

    // add all thread messages to description
    const msgs = this.thread.messages
      .filter(msg => ['user', 'system'].includes(msg.role))
      .map(msg => msg.content)
      .join('\n\n');

    // add from username to description
    const lastMessage = this.thread.msgs[this.thread.msgs.length - 1]
    const fromUsername = lastMessage.from?.username || '';
    options.description += `\n\nПолный текст:\n${fromUsername ? `От ${fromUsername}\n\n` : ''}${msgs}`

    const postBody = {
      name: this.replaceTemplaceVars(conf.name, options),
      description: options.description,
      template: conf.templateId ? {
        id: `${conf.templateId}`,
      } : undefined
    } as TaskBodyType;

    // const res = this.createTestFileTask(postBody)
    const res = this.createPlanfixTask(postBody)
    return res
  }

  replaceTemplaceVars(template: string, vars: Record<string, string>) {
    for (const [key, value] of Object.entries(vars)) {
      template = template.replace(new RegExp(`{${key}}`, 'g'), value)
    }
    return template
  }

  async createPlanfixTask(postBody: TaskBodyType): Promise<ToolResponse> {
    postBody.description = postBody.description.replace(/\n/g, '<br>')
    try {
      type PlanfixCreatedResponse = {
        result: string,
        id: number,
      }
      const answer = await this.ky.post('task/', {json: postBody}).json<PlanfixCreatedResponse>() // json()<PlanfixResponse>
      const url = `https://${this.configChat.toolParams.planfix?.account}.planfix.com/task/${answer.id}`

      // console.log("answer:", JSON.stringify(answer, null, 2));

      return {
        content: `Задача создана:\n${url}\n\n${postBody.description.replace(/<br>/g, '\n')}`
      }
    } catch (e) {
      console.error(e);
    }

    return {
      content: 'Не удалось создать задачу'
    }
  }

  createTestFileTask(postBody: TaskBodyType): ToolResponse {
    // y-m-d_h-m-s
    const date = new Date().toISOString().replace(/[-:]/g, '_').replace('T', '_').replace(/\..+/, '')
    const fileRelPath = `/em/planfix/${date}.html`;
    const fileBasePath = 'h:/www/files.popstas.ru';

    fs.writeFileSync(`${fileBasePath}${fileRelPath}`, `<meta charset="UTF-8"><pre>${yaml.dump(postBody)}</pre>`)

    const url = 'https://files.popstas.ru' + fileRelPath
    return {
      content: `Задача создана:\n${url}\n\n${postBody.description}`
    }
  }

  options_string(str: string) {
    const options = JSON.parse(str) as TaskArgsType;
    if (!options) return str
    const optionsStr = Object.entries(options)
      .filter(([key, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    return `**Create Planfix Task:** \`${optionsStr}\``
  }
}


export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new PlanfixCreateTaskClient(configChat, thread);
}
