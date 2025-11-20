import path from "node:path";
import OpenAI from "openai";

import { ConfigChatType, ThreadStateType } from "../../types.ts";
import { ensureDirectoryExists } from "../../helpers.ts";
import { resolveScreenshotExtension, resolveScreenshotPath } from "./toolScreenshot.ts";

export function applyToolHandler(
  toolName: string,
  toolParams: string,
  context: ToolHandlerContext,
): string {
  const handler = toolHandlers[toolName];
  if (!handler) {
    return toolParams;
  }

  return handler(toolParams, context);
}

function augmentPlanfixLeadTaskParams(toolParams: string, context: ToolHandlerContext): string {
  const { thread } = context;
  const firstMessage = thread.msgs[0];
  const from = firstMessage.from;
  const fromUsername = from?.username || "";
  const msgs = thread.messages
    .filter((m) => ["user", "system"].includes(m.role))
    .map((m) => {
      const userMsg = m as OpenAI.ChatCompletionUserMessageParam;
      const name = userMsg.role === "user" ? userMsg.name : userMsg.role;
      return `${name}:\n${userMsg.content}`;
    })
    .join("\n\n");
  const toolParamsParsed = JSON.parse(toolParams) as {
    description: string;
  };
  if (!toolParamsParsed.description) toolParamsParsed.description = "";
  const fromStr = fromUsername ? `От ${fromUsername}` : "";
  toolParamsParsed.description += `\n\nПолный текст:\n${fromStr}\n\n${msgs}\n`;
  return JSON.stringify(toolParamsParsed);
}

function normalizeScreenshotParams(toolParams: string): string {
  const toolParamsParsed = JSON.parse(toolParams) as {
    format?: string;
    quality?: number;
    uid?: string;
    fullPage?: boolean;
    filePath?: string;
    url?: string;
  };

  if ((toolParamsParsed.format || "").toLowerCase() === "png") delete toolParamsParsed.quality;
  if (toolParamsParsed.uid && toolParamsParsed.fullPage) delete toolParamsParsed.uid;

  if (!toolParamsParsed.filePath) {
    const extension = resolveScreenshotExtension(toolParamsParsed.format);
    const sanitized = resolveScreenshotPath(
      path.resolve("data", "screenshots"),
      toolParamsParsed.url,
      extension,
    );
    ensureDirectoryExists(sanitized);
    toolParamsParsed.filePath = sanitized;
  }

  return JSON.stringify(toolParamsParsed);
}

const toolHandlers: Record<string, ToolHandler> = {
  planfix_add_to_lead_task: augmentPlanfixLeadTaskParams,
  take_screenshot: normalizeScreenshotParams,
};

export interface ToolHandlerContext {
  chatConfig: ConfigChatType;
  thread: ThreadStateType;
  toolCall: OpenAI.ChatCompletionMessageToolCall;
}

type ToolHandler = (toolParams: string, context: ToolHandlerContext) => string;
