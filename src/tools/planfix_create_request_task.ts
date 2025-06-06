import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import defaultKy, { type KyInstance } from "ky";
import { z } from "zod";
import { readConfig } from "../config.ts";
import {
  ConfigChatType,
  ConfigType,
  ThreadStateType,
  ToolResponse,
} from "../types.ts";
import * as fs from "node:fs";
import * as yaml from "js-yaml";
import { log } from "../helpers.ts";

type TaskArgsType = {
  clientName: string;
  phone?: string;
  email?: string;
  telegram?: string;
  referrer?: string;
  description: string;
};

type UserDataType = {
  name?: string;
  phone?: string;
  email?: string;
  telegram?: string;
};

type CustomFieldDataType = {
  field: {
    id: number;
  };
  value: string | { id: number };
};

type TaskBodyType = {
  customFieldData: CustomFieldDataType[];
  name: string;
  description: string;
  template?: {
    id: string;
  };
};

type UsersListType = {
  users: {
    id: number;
  }[];
};

type PlanfixContactType = {
  id: number;
  name: string;
};

type TaskResultType = {
  id: number;
  assignees: UsersListType;
};

type PlanfixCreatedContactResponse = {
  result: string;
  id: number;
};

export const description = "Creates new task in CRM Planfix.";
export const details = `- create contactsMap from clientName, phone, email, telegram, referrer in task description
- add all thread messages to description
- add from username to description
- create task in Planfix`;

export const defaultParams = {
  planfix: {
    account: "your_account",
    token: "rest_api_token",
  },
  planfix_create_request_task: {
    name: "New task for {clientName}",
    templateId: 0,
  },
} as {
  planfix: { account: string; token: string };
  planfix_create_request_task: { name: string; templateId: number };
};

export class PlanfixCreateTaskClient extends AIFunctionsProvider {
  protected readonly ky: KyInstance;
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  protected readonly thread: ThreadStateType;
  protected lastError: string;
  protected readonly details: string;

  constructor(configChat: ConfigChatType, thread: ThreadStateType) {
    super();

    this.config = readConfig();
    this.configChat = configChat;
    this.thread = thread;
    this.lastError = "";
    this.details = details;

    // load contacts (agents)
    // const cg = this.configChat.toolParams.planfix_create_request_task?.contactsGroups;
    // const contactsAgents = this.getContactsGroupMap(cg?.agents || 0);

    this.ky = defaultKy.extend({
      prefixUrl: `https://${this.configChat.toolParams.planfix?.account}.planfix.com/rest/`,
      headers: {
        Authorization: `Bearer ${this.configChat.toolParams.planfix?.token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 30000, // Set timeout to 30 seconds
    });
  }

  @aiFunction({
    name: "planfix_create_request_task",
    description,
    inputSchema: z.object({
      clientName: z.string().describe('Name of client. Example: "Maria"'),
      phone: z.string().optional().describe('Phone. Example: "+79222222222"'),
      email: z.string().optional().describe('Email. Example: "me@gmail.com"'),
      telegram: z
        .string()
        .optional()
        .describe('Telegram login. Example: "@maria"'),
      referrer: z
        .string()
        .optional()
        .describe('Реферал. Пример: "Иван Петров"'),
      description: z
        .string()
        .describe(
          'Description of the task. Example: "Call Maria to discuss new project"',
        ),
    }),
  })
  async planfix_create_request_task(
    options: TaskArgsType,
  ): Promise<ToolResponse> {
    const conf = this.configChat.toolParams.planfix_create_request_task;
    if (!conf)
      return {
        content: "No config",
      };

    let taskId: number | null = null;
    let assignees: UsersListType = { users: [] };
    this.lastError = "";

    // add contacts to description
    const contactsMap =
      this.configChat.toolParams.planfix_create_request_task?.contactsMap || [];
    const contacts = [];
    for (const { title, field_name } of contactsMap) {
      const value = options[field_name as keyof TaskArgsType];
      if (value) contacts.push(`${title}: ${value}`);
    }
    options.description = contacts.join("\n") + "\n\n" + options.description;

    // add all thread messages to description
    const msgs = this.thread.messages
      .filter((msg) => ["user", "system"].includes(msg.role))
      .map((msg) => msg.content)
      .join("\n\n");

    // add from username to description
    const lastMessage = this.thread.msgs[this.thread.msgs.length - 1];
    const fromUsername = lastMessage.from?.username || "";
    options.description += `\n\nПолный текст:\n${fromUsername ? `От ${fromUsername}\n\n` : ""}${msgs}`;

    const userData = {
      name: options.clientName,
      phone: options.phone,
      email: options.email,
      telegram: options.telegram,
    } as UserDataType;

    // 1. search contact by userData
    let clientId = await this.searchPlanfixContact(userData);
    if (clientId) {
      // search task by client
      const result = await this.searchPlanfixTask({ clientId: clientId });
      if (result) {
        taskId = result.id;
        assignees = result.assignees;
      }
    } else {
      // создаём клиента
      clientId = await this.createPlanfixContact(userData);
    }

    const postBody = {
      name: this.replaceTemplaceVars(conf.name, options),
      description: options.description,
      template: conf.templateId
        ? {
            id: `${conf.templateId}`,
          }
        : undefined,
      customFieldData: [],
    } as TaskBodyType;

    // Add clientId to customFieldData if available
    if (clientId) {
      postBody.customFieldData.push({
        field: {
          id:
            this.configChat.toolParams.planfix_create_request_task?.fieldIds
              ?.client || 0,
        },
        value: {
          id: clientId,
        },
      });
    }

    // search for duplicates
    const result = await this.searchPlanfixTask({ taskName: postBody.name });
    if (result) {
      return {
        content: `Задача уже существует:\n${this.getTaskUrl(result.id)}`,
      };
    }

    if (this.isDryRun()) {
      log({ msg: "Dry run", logLevel: "info" });
    }
    // const res = this.createTestFileTask(postBody)
    // return dryRun ? this.createTestFileTask(postBody) : this.createPlanfixTask(postBody);

    if (!taskId) {
      return this.createPlanfixTask(postBody);
    } else {
      await this.createComment({
        id: taskId,
        description: options.description,
        recipients: assignees,
      });
      return {
        content: `Задача уже существует, в неё добавлен комментарий:\n${this.getTaskUrl(taskId)}`,
      };
    }
  }

  getTaskUrl(id: number) {
    return `https://${this.configChat.toolParams.planfix?.account}.planfix.com/task/${id}`;
  }

  isDryRun() {
    return this.configChat.toolParams.planfix_create_request_task?.dryRun;
  }
  replaceTemplaceVars(template: string, vars: Record<string, string>) {
    for (const [key, value] of Object.entries(vars)) {
      template = template.replace(new RegExp(`{${key}}`, "g"), value);
    }
    return template;
  }

  async searchPlanfixContact({ name, phone, email, telegram }: UserDataType) {
    let contactId: number | null = null;
    const postBody = {
      offset: 0,
      pageSize: 100,
      filters: [] as object[],
      fields: "id,name",
    };

    const filters = {
      byName: {
        type: 4001,
        operator: "equal",
        value: name,
      },
      byPhone: {
        type: 4003,
        operator: "equal",
        value: phone,
      },
      byEmail: {
        type: 4026,
        operator: "equal",
        value: email,
      },
      byTelegram: {
        type: 4101,
        field:
          this.configChat.toolParams.planfix_create_request_task?.fieldIds
            ?.telegram,
        // operator: 'equal',
        // value: '@' + telegram,
        operator: "have",
        value: telegram,
      },
    };

    const searchWithFilter = async (
      filter: object,
      label: string,
    ): Promise<number | null> => {
      console.log(`search contact with filter: ${label}`);
      postBody.filters = [filter];
      type PlanfixContactsListResponse = {
        // ok: boolean,
        // status: number,
        result: string;
        contacts: PlanfixContactType[];
      };
      try {
        const answer = await this.ky
          .post("contact/list", { json: postBody })
          .json<PlanfixContactsListResponse>(); // json()<PlanfixResponse>
        /* const response = await fetch(`${baseUrl}contact/list`, {
          method: 'POST',
          headers,
          body: JSON.stringify(postBody)
        }); */

        /* if (!answer.ok) {
          throw new Error(`HTTP error! Status: ${answer.status}`);
        } */

        if (answer.contacts && answer.contacts.length > 0) {
          contactId = answer.contacts[0].id;
          console.log(`Contact found by ${label}: ${contactId}`);
        }
        return contactId;
      } catch (error) {
        const err = error as Error;
        this.lastError = "Error searching for contacts";
        console.error(`${this.lastError}:`, err.message);
        return null;
      }
    };

    try {
      if (email) {
        contactId = await searchWithFilter(filters.byEmail, "email");
      }
      if (!contactId && phone) {
        contactId = await searchWithFilter(filters.byPhone, "phone");
      }
      if (!contactId && name) {
        contactId = await searchWithFilter(filters.byName, "name");
      }
      if (!contactId && telegram) {
        contactId = await searchWithFilter(filters.byTelegram, "telegram");
      }
      return contactId;
    } catch (error) {
      const err = error as Error;
      console.error("Error searching for contacts:", err.message);
      return null;
    }
  }

  splitName(fullName?: string) {
    if (!fullName) {
      return { firstName: "", lastName: "" };
    }

    const nameParts = fullName.trim().split(/\s+/);
    if (nameParts.length === 1) {
      return { firstName: nameParts[0], lastName: "" };
    } else {
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ");
      return { firstName, lastName };
    }
  }

  async createPlanfixContact(userData: UserDataType): Promise<number | null> {
    try {
      console.log("Creating new contact");

      const { firstName, lastName } = this.splitName(userData.name);

      const postBody = {
        template: {
          id: this.configChat.toolParams.planfix_create_request_task
            ?.contactsTemplates.contacts,
        },
        name: firstName,
        lastname: lastName,
        email: userData.email,
        phones: [] as object[],
        customFieldData: [] as CustomFieldDataType[],
      };

      // Add phone if available
      if (userData.phone) {
        postBody.phones = [
          {
            number: userData.phone,
            type: 1,
          },
        ];
      }

      // Add Telegram as custom field if available
      if (userData.telegram) {
        postBody.customFieldData = [
          {
            field: {
              id:
                this.configChat.toolParams.planfix_create_request_task?.fieldIds
                  ?.telegram || 0,
            },
            value: "@" + userData.telegram.replace(/@/, ""),
          },
        ];
      }

      const result = this.isDryRun()
        ? { id: 123 }
        : await this.ky
            .post("contact/", { json: postBody })
            .json<PlanfixCreatedContactResponse>();
      console.log(`Contact created with ID: ${result.id}`);
      return result.id;
    } catch (error) {
      const err = error as Error;
      this.lastError = "Error searching for contacts";
      console.error(`${this.lastError}:`, err.message);
      return null;
    }
  }

  async createPlanfixTask(postBody: TaskBodyType): Promise<ToolResponse> {
    postBody.description = postBody.description.replace(/\n/g, "<br>");
    try {
      type PlanfixCreatedTaskResponse = {
        result: string;
        id: number;
      };
      const answer = this.isDryRun()
        ? { id: 234 }
        : await this.ky
            .post("task/", { json: postBody })
            .json<PlanfixCreatedTaskResponse>();
      const url = this.getTaskUrl(answer.id);

      // console.log("answer:", JSON.stringify(answer, null, 2));

      return {
        content: `Задача создана:\n${url}\n\n${postBody.description.replace(/<br>/g, "\n")}`,
      };
    } catch (e) {
      this.lastError = "Error creating Planfix task";
      console.error(`${this.lastError}:`, e);
    }

    return {
      content: "Не удалось создать задачу: " + this.lastError,
    };
  }

  async createComment({
    id,
    description,
    recipients,
  }: {
    id: number;
    description: string;
    recipients: UsersListType;
  }): Promise<number | null> {
    try {
      console.log(`Creating comment for task ${id}`);

      const postBody = {
        description: description.replace(/\n/g, "<br>"),
        recipients: recipients,
      };

      type PlanfixCreatedCommentResponse = {
        result: string;
        id: number;
      };

      const answer = this.isDryRun()
        ? { id: 345 }
        : await this.ky
            .post(`task/${id}/comments/`, { json: postBody })
            .json<PlanfixCreatedCommentResponse>();

      console.log(`Comment created with ID: ${answer.id}`);
      return answer.id;
    } catch (error) {
      const err = error as Error;
      this.lastError = "Error creating comment";
      console.error(`${this.lastError}:`, err.message);
      return null;
    }
  }

  createTestFileTask(postBody: TaskBodyType): ToolResponse {
    // y-m-d_h-m-s
    const date = new Date()
      .toISOString()
      .replace(/[-:]/g, "_")
      .replace("T", "_")
      .replace(/\..+/, "");
    const fileRelPath = `/em/planfix/${date}.html`;
    const fileBasePath = "h:/www/files.popstas.ru";

    fs.writeFileSync(
      `${fileBasePath}${fileRelPath}`,
      `<meta charset="UTF-8"><pre>${yaml.dump(postBody)}</pre>`,
    );

    const url = "https://files.popstas.ru" + fileRelPath;
    return {
      content: `Задача создана:\n${url}\n\n${postBody.description}`,
    };
  }

  options_string(str: string) {
    const options = JSON.parse(str) as TaskArgsType;
    if (!options) return str;
    const optionsStr = Object.entries(options)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
    return `**Create Planfix Task:** \`${optionsStr}\``;
  }

  async getContactsGroupMap(groupId: number) {
    const items = await this.getContactGroupItemsRest(groupId);
    const itemsMap = {};

    items.map((item) => {
      // @ts-expect-error: item.name is dynamic and not in index signature
      itemsMap[item.name] = item.id;
      // return field.value;
    });
    return itemsMap;
  }

  async getContactGroupItemsRest(groupId: number) {
    type PlanfixContact = {
      id: number;
      name: string;
      midname: string;
      lastname: string;
      group: number;
    };
    type PlanfixContactsResponse = {
      data?: {
        contacts: PlanfixContact[];
      };
    };
    let isEnd = false;
    let offset = 0;
    const allItems = [];
    try {
      while (!isEnd) {
        const params = {
          offset,
          pageSize: 100,
          fields: "id,name,midname,lastname,group",
          filters: [
            {
              type: 4008,
              operator: "equal",
              value: groupId,
            },
          ],
        };
        const answer = await this.ky
          .post("contact/list", { json: params })
          .json<PlanfixContactsResponse>(); // json()<PlanfixResponse>
        // const res = await planfixRest('contact/list', params, 'post');
        const items = answer?.data?.contacts || [];

        if (items.length < params.pageSize) isEnd = true;
        // if (!isEnd) log(`items.length: ${items.length}`, 'debug');

        // remove archived
        // items = items.filter(item => item.archived != '1');

        allItems.push(...items);
        offset += params.pageSize;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log({ msg: `getContactGroupItemsRest: ${msg}`, logLevel: "error" });
    }

    return allItems;
  }

  async searchPlanfixTask({
    taskName,
    clientId,
  }: {
    taskName?: string;
    clientId?: number;
  }): Promise<TaskResultType | null> {
    let taskId: number | null = null;
    let assignees: UsersListType = { users: [] };

    const postBody = {
      offset: 0,
      pageSize: 100,
      filters: [] as object[],
      fields: "id,name,description,template,assignees",
    };

    type PlanfixTasksResponse = {
      result: string;
      tasks: TaskResultType[];
    };

    const filtersDefault = [
      {
        type: 51, // filter by template
        operator: "equal",
        value:
          this.configChat.toolParams.planfix_create_request_task?.templateId,
      },
      {
        type: 12, // filter by created date
        operator: "equal",
        value: {
          dateType: "last",
          dateValue:
            this.configChat.toolParams.planfix_create_request_task
              ?.daysToSearch, // last N days
        },
      },
    ];

    const filters = {
      byClient: {
        type: 108,
        field:
          this.configChat.toolParams.planfix_create_request_task?.fieldIds
            ?.client,
        operator: "equal",
        value: `contact:${clientId}`,
      },
      byName: {
        type: 8,
        operator: "equal",
        value: taskName,
      },
    };

    const searchWithFilter = async (
      filter: object,
      label: string,
    ): Promise<TaskResultType | null> => {
      console.log(`search task with filter: ${label}`);
      postBody.filters = [...filtersDefault, filter];
      try {
        const answer = await this.ky
          .post("task/list", { json: postBody })
          .json<PlanfixTasksResponse>(); // json()<PlanfixResponse>
        /* const response = await fetch(`${baseUrl}task/list`, {
          method: 'POST',
          headers,
          body: JSON.stringify(postBody)
        }); */

        if (answer.tasks && answer.tasks.length > 0) {
          taskId = answer.tasks[0].id;
          assignees = answer.tasks[0].assignees;
          console.log(`Task found by ${label}: ${taskId}`);
        }
        return taskId ? { id: taskId, assignees } : null;
      } catch (error) {
        const err = error as Error;
        this.lastError = "Error searching for tasks";
        console.error(`${this.lastError}:`, err.message);
        return null;
      }
    };

    try {
      if (clientId) {
        const result = await searchWithFilter(filters.byClient, "client");
        if (result) {
          taskId = result.id;
          assignees = result.assignees;
        }
      }
      if (!taskId && taskName) {
        const result = await searchWithFilter(filters.byName, "name");
        if (result) {
          taskId = result.id;
          assignees = result.assignees;
        }
      }
      return taskId ? { id: taskId, assignees } : null;
    } catch (error) {
      const err = error as Error;
      this.lastError = "Error searching for tasks";
      console.error(`${this.lastError}:`, err.message);
      return null;
    }

    /* const answer = await this.ky.post('task/list', {json: postBody}).json<PlanfixTasksResponse>() // json()<PlanfixResponse>
    if (answer.tasks.length > 0) taskUrl = `https://${this.configChat.toolParams.planfix?.account}.planfix.com/task/${answer.tasks[0].id}`

    return taskUrl; */
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new PlanfixCreateTaskClient(configChat, thread);
}
