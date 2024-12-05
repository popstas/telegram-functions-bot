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
import {log} from "../helpers.ts";

type TaskArgsType = {
  clientName: string,
  phone?: string,
  email?: string,
  telegram?: string,
  referrer?: string,
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
export const details = `- create contactsMap from clientName, phone, email, telegram, referrer in task description
- add all thread messages to description
- add from username to description
- create task in Planfix`
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
        .optional()
        .describe(
          'Phone. Example: "+79222222222"'
        ),
      email: z
        .string()
        .optional()
        .describe(
          'Email. Example: "me@gmail.com"'
        ),
      telegram: z
        .string()
        .optional()
        .describe(
          'Telegram login. Example: "@maria"'
        ),
      referrer: z
        .string()
        .optional()
        .describe(
          'Реферал. Пример: "Иван Петров"'
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
    const contactsMap = this.configChat.toolParams.planfix_create_request_task?.contactsMap || [];
    const contacts = []
    for (const {title, field_name} of contactsMap) {
      const value = options[field_name as keyof TaskArgsType]
      if (value) contacts.push(`${title}: ${value}`)
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

    // search for duplicates
    const foundUrl = await this.searchPlanfixTask(postBody.name);
    if (foundUrl) {
      return {
        content: `Задача уже существует:\n${foundUrl}`
      }
    }

    const dryRun = this.configChat.toolParams.planfix_create_request_task?.dryRun;
    if (dryRun) {
      log({msg: 'Dry run', logLevel: 'info'});
    }
    // const res = this.createTestFileTask(postBody)
    return dryRun ? this.createTestFileTask(postBody) : this.createPlanfixTask(postBody);
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

  async searchPlanfixTask(taskName: string): Promise<String> {
    let taskUrl = '';
    const postBody = {
      offset: 0,
      pageSize: 100,
      filters: [
        {
          type: 51, // filter by template
          operator: 'equal',
          value: this.configChat.toolParams.planfix_create_request_task?.templateId,
        },
        {
          type: 12, // filter by created date
          operator: 'equal',
          value: {
            dateType: 'last',
            dateValue: 3, // last 3 days
          },
        },
        {
          type: 8, // filter by task name
          operator: 'equal',
          value: taskName,
        },
      ],
      fields: 'id,name,description,template'
    }
    type PlanfixTasksResponse = {
      result: string,
      tasks: {
        id: number,
      }[],
    }

    const answer = await this.ky.post('task/list', {json: postBody}).json<PlanfixTasksResponse>() // json()<PlanfixResponse>
    if (answer.tasks.length > 0) taskUrl = `https://${this.configChat.toolParams.planfix?.account}.planfix.com/task/${answer.tasks[0].id}`

    return taskUrl;
  }
}


export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new PlanfixCreateTaskClient(configChat, thread);
}
