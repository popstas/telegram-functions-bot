import {
  aiFunction,
  AIFunctionsProvider,
} from '@agentic/core'
import defaultKy, {type KyInstance} from 'ky'
import {z} from 'zod'
import {readConfig} from '../config.ts'
import {ConfigType} from "../types.ts";
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

export interface PlanfixResponse {
  url: string
  title: string
  description: string
}

export class PlanfixClient extends AIFunctionsProvider {
  protected readonly ky: KyInstance
  protected readonly config: ConfigType

  constructor({ky = defaultKy}: { ky?: KyInstance } = {}) {
    super()

    this.config = readConfig();
    this.ky = ky.extend({
      prefixUrl: `https://${this.config.planfix.account}.planfix.com/rest/`,
      headers: {
        Authorization: `Bearer ${this.config.planfix.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }
    })
  }

  async createTask(options: TaskArgsType): Promise<PlanfixResponse> {
    try {
      const postBody = {
        name: `${options.clientName} - работа с клиентом` ,
        description: options.description.replace(/\n/g, '<br>'),
        template: {
          id: `${this.config.planfix.templateId}`,
        }
      };

      type PlanfixCreatedResponse = {
        result: string,
        id: number,
      }
      const answer = await this.ky.post('task/', {json: postBody}).json<PlanfixCreatedResponse>() // json()<PlanfixResponse>
      const url = `https://${this.config.planfix.account}.planfix.com/task/${answer.id}`

      // console.log("answer:", JSON.stringify(answer, null, 2));

      return {
        title: 'task',
        url,
        description: options.description,
      }
    } catch (e) {
      console.error(e);
    }

    return {
      title: '',
      url: '',
      description: ''
    }
  }

  @aiFunction({
    name: 'create_planfix_task',
    description: 'Creates new task in CRM Planfix.',
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

  async createPlanfixTask(options: TaskArgsType) {
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

    // const res = this.createFileTask(options)
    const res = this.createTask(options)

    return res
  }

  /*createFileTask(options: TaskArgsType) {
    // y-m-d_h-m-s
    const date = new Date().toISOString().replace(/[-:]/g, '_').replace('T', '_').replace(/\..+/, '')
    const fileRelPath = `/em/planfix/${date}.html`;
    const fileBasePath = 'h:/www/files.popstas.ru';

    fs.writeFileSync(`${fileBasePath}${fileRelPath}`, `<meta charset="UTF-8"><pre>${yaml.dump(options)}</pre>`)

    return {
      title: 'task',
      url: 'https://files.popstas.ru' + fileRelPath,
      description: options.description,
    } as PlanfixResponse
  }*/
}