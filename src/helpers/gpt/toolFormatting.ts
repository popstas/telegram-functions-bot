import OpenAI from "openai";
import type { ChatCompletionMessageToolCall } from "openai/resources/chat/completions";

import { ModuleType } from "../../types.ts";

// Type guard for standard function tool calls (OpenAI v6 compatibility)
function isFunctionToolCall(
  toolCall: ChatCompletionMessageToolCall,
): toolCall is ChatCompletionMessageToolCall & { function: { name: string; arguments: string } } {
  return "function" in toolCall && toolCall.function !== undefined;
}

export function prettifyKeyValue(key: string, value: unknown, level = 0): string {
  const prettifiedKey = prettifyKey(key);
  const prefix = "  ".repeat(level) + "-";

  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      if (value.length === 0) return `${prefix} *${prettifiedKey}:* (empty)`;
      return [
        `${prefix} *${prettifiedKey}:*`,
        ...value.map((v, i) => prettifyKeyValue(String(i), v, level + 1)),
      ].join("\n");
    }

    const entries = Object.entries(value);
    if (entries.length === 0) return `${prefix} *${prettifiedKey}:* (empty)`;
    return [
      `${prefix} *${prettifiedKey}:*`,
      ...entries.map(([k, v]) => prettifyKeyValue(k, v, level + 1)),
    ].join("\n");
  }

  return `${prefix} *${prettifiedKey}:* ${value}`;
}

export function removeNullsParams(params: string): string {
  const filteredParams = Object.fromEntries(
    Object.entries(JSON.parse(params)).filter(([, value]) => value !== null),
  );
  return JSON.stringify(filteredParams);
}

export function addChatIdToTelegramGetMessagesParams(
  params: string,
  toolName: string,
  chatId: number,
): string {
  if (toolName !== "telegram_get_messages") {
    return params;
  }
  const parsed = JSON.parse(params) as Record<string, unknown>;
  parsed.chat_id = String(chatId);
  return JSON.stringify(parsed);
}

export function formatToolParamsString({
  toolCall,
  toolClient,
  toolParams,
}: {
  toolCall: OpenAI.ChatCompletionMessageToolCall;
  toolClient: ModuleType;
  toolParams: string;
}): string {
  if (!isFunctionToolCall(toolCall)) {
    return "Invalid tool call";
  }

  if (["expertizeme_search_items", "expertizeme_export_items"].includes(toolCall.function.name)) {
    return prettifyExpertizemeSearchItems(JSON.parse(toolParams), toolCall.function.name);
  }

  const defaultParams = [
    "`" + (toolClient.agent ? "Agent: " : "") + toolCall.function.name.replace(/[_-]/g, " ") + ":`",
    ...Object.entries(JSON.parse(toolParams)).map(([key, value]) => prettifyKeyValue(key, value)),
  ].join("\n");

  if (typeof toolClient.options_string === "function") {
    return toolClient.options_string(toolParams);
  }

  return defaultParams;
}

export function prettifyExpertizemeSearchItems(params: SearchParams, toolName: string): string {
  const title = toolName === "expertizeme_search_items" ? "Поиск СМИ:" : "Экспорт СМИ:";
  const lines: string[] = ["`" + title + "`"];

  if (Array.isArray(params.filters)) {
    for (const filter of params.filters) {
      if (typeof filter === "object" && filter !== null) {
        const field = prettifyKey(filter.field) || "";
        const operator = filter.operator || "";
        const value = filter.value;
        let valueStr = "";
        if (Array.isArray(value)) {
          valueStr = joinWithOr(value);
        } else {
          valueStr = value !== undefined ? String(value) : "";
        }
        const opStr = operator === "not" ? "not " : "";
        lines.push(`- **${field}**: ${opStr}${valueStr}`);
      }
    }
  }

  for (const [key, value] of Object.entries(params)) {
    if (["filters", "limit", "sortField", "sortDirection", "groupBy"].includes(key)) continue;
    if (Array.isArray(value)) {
      lines.push(`- **${prettifyKey(key)}**: ${joinWithOr(value)}`);
    } else {
      lines.push(`- **${prettifyKey(key)}**: ${value}`);
    }
  }

  if (params.sortField && typeof params.sortField === "string") {
    const sortLine =
      "- **Sort by** " +
      prettifyKey(params.sortField) +
      (params.sortDirection === "desc" ? " (descending)" : "");
    lines.push(sortLine);
  }

  if (params.groupBy && typeof params.groupBy === "string") {
    const groupByLine = "- **Group by** " + prettifyKey(params.groupBy);
    lines.push(groupByLine);
  }

  return lines.join("\n");
}

function joinWithOr(arr: unknown[]): string {
  const normalized = arr.map((value) => String(value));
  if (normalized.length === 0) return "";
  if (normalized.length === 1) return normalized[0];
  return normalized.slice(0, -1).join(", ") + " or " + normalized[normalized.length - 1];
}

function prettifyKey(key?: string): string {
  if (!key) return "";
  const normalized = key.replace(/[_-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

interface FilterType {
  field?: string;
  operator?: string;
  value?: unknown;
}

interface SearchParams {
  filters?: FilterType[];
  query?: string;
  [key: string]: unknown;
}
