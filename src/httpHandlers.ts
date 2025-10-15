import type express from "express";
import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { useConfig } from "./config.ts";
import { log, stringToId } from "./helpers.ts";
import { requestGptAnswer } from "./helpers/gpt/llm.ts";
import { resolveChatTools } from "./helpers/gpt/tools.ts";
import type { ThreadStateType, ConfigChatType } from "./types.ts";
import { readFileSync } from "fs";
import { addToHistory } from "./helpers/history.ts";

const HTTP_LOG_PATH = "data/http.log";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const version = pkg.version;

export async function agentGetHandler(req: express.Request, res: express.Response) {
  const { agentName } = req.params;

  try {
    res.json({
      name: agentName,
      version,
      status: "online",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in agentGetHandler:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

function checkAuth(chatConfig?: ConfigChatType, token?: string) {
  const globalToken = useConfig().http?.http_token;
  const chatToken = chatConfig?.http_token;
  const requestToken = token?.split(" ")[1];
  const isAccess =
    (chatToken && requestToken === chatToken) || (globalToken && requestToken === globalToken);
  return isAccess;
}

export async function agentPostHandler(req: express.Request, res: express.Response) {
  const { agentName } = req.params;
  const { text, webhook, chat_id: chatIdFromBody } = req.body || {};
  const token = req.headers["authorization"];
  const agentConfig = useConfig().chats.find((c) => c.agent_name === agentName);
  if (!checkAuth(agentConfig, token)) {
    log({
      msg: "Unauthorized",
      logLevel: "warn",
      logPath: HTTP_LOG_PATH,
    });
    return res.status(401).send("Unauthorized");
  }
  if (!text) {
    log({
      msg: "Message text is required.",
      logLevel: "warn",
      logPath: HTTP_LOG_PATH,
    });
    return res.status(400).send("Message text is required.");
  }
  if (!agentConfig) {
    log({
      msg: "Wrong agent_name",
      logLevel: "warn",
      logPath: HTTP_LOG_PATH,
    });
    return res.status(400).send("Wrong agent_name");
  }
  const forwardedFor = req.headers["x-forwarded-for"];
  const ipAddress = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(",")[0]?.trim() || req.ip || req.socket?.remoteAddress || "";
  const defaultChatId =
    Number.parseInt(`444${stringToId(agentName)}`, 10) + stringToId(ipAddress || "");
  const bodyChatId = (() => {
    if (chatIdFromBody === undefined || chatIdFromBody === null) {
      return undefined;
    }
    if (typeof chatIdFromBody === "number") {
      return Number.isFinite(chatIdFromBody) ? Math.trunc(chatIdFromBody) : undefined;
    }
    if (typeof chatIdFromBody === "string") {
      const trimmedChatId = chatIdFromBody.trim();
      if (!trimmedChatId) {
        return undefined;
      }
      return /^\d+$/.test(trimmedChatId)
        ? Number.parseInt(trimmedChatId, 10)
        : stringToId(trimmedChatId);
    }
    return stringToId(String(chatIdFromBody));
  })();
  const configuredChatId =
    typeof agentConfig.id === "number" && Number.isFinite(agentConfig.id)
      ? agentConfig.id
      : undefined;
  const chatId = bodyChatId ?? configuredChatId ?? defaultChatId;
  const msg = {
    chat: { id: chatId, type: "private" as const },
    text,
    message_id: Date.now(),
    date: Math.floor(Date.now() / 1000),
    from: { id: 0, is_bot: false, first_name: "http" },
  } as Message.TextMessage;
  log({
    msg: msg.text,
    chatId,
    chatTitle: "http",
    username: "http",
    role: "user",
    logPath: HTTP_LOG_PATH,
  });

  // Add user message to history before requesting answer
  addToHistory(msg, agentConfig);

  const resObj = await requestGptAnswer(msg, agentConfig, {
    noSendTelegram: true,
  } as unknown as Context);
  const answer = resObj?.content || "";
  log({
    msg: answer,
    chatId,
    chatTitle: "http: " + agentName,
    username: "http",
    role: "assistant",
    logPath: HTTP_LOG_PATH,
  });
  res.contentType("text/plain; charset=utf-8");
  res.end(answer);
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answer }),
      });
    } catch {
      // ignore webhook errors
    }
  }
}

export async function toolPostHandler(req: express.Request, res: express.Response) {
  const { agentName, toolName } = req.params;
  const args = req.body || {};
  const token = req.headers["authorization"];
  const agentConfig = useConfig().chats.find((c) => c.agent_name === agentName);
  if (!checkAuth(agentConfig, token)) {
    log({
      msg: "Unauthorized",
      logLevel: "warn",
      logPath: HTTP_LOG_PATH,
    });
    return res.status(401).send("Unauthorized");
  }
  if (!agentConfig) {
    log({
      msg: "Wrong agent_name",
      logLevel: "warn",
      logPath: HTTP_LOG_PATH,
    });
    return res.status(400).send("Wrong agent_name");
  }
  const chatId = agentConfig.id || parseInt("666" + Math.floor(100000 + Math.random() * 900000));
  const thread = {
    id: chatId,
    msgs: [],
    messages: [],
    completionParams: agentConfig.completionParams,
  } as ThreadStateType;
  const chatTools = await resolveChatTools(
    {
      chat: { id: chatId, type: "private" as const },
      text: "",
      message_id: Date.now(),
      date: Math.floor(Date.now() / 1000),
      from: { id: 0, is_bot: false, first_name: "http" },
    } as Message.TextMessage,
    agentConfig,
  );
  const chatTool = chatTools.find((f) => f.name === toolName);
  if (!chatTool) {
    log({
      msg: `Wrong tool_name: ${toolName}`,
      logLevel: "warn",
      logPath: HTTP_LOG_PATH,
    });
    return res.status(400).send(`Wrong tool_name: ${toolName}`);
  }
  const fn = chatTool.module.call(agentConfig, thread).functions.get(toolName);
  const argsStr = typeof args === "string" ? args : JSON.stringify(args || {});
  log({
    msg: `${toolName}: ${argsStr}`,
    chatId,
    chatTitle: "http",
    username: "http",
    role: "user",
    logPath: HTTP_LOG_PATH,
  });
  let result;
  try {
    let jsonAnswer;
    result = await fn(argsStr);
    const toolAnswer = JSON.parse(result.content);
    const arr = Array.isArray(toolAnswer) ? toolAnswer : toolAnswer.content;
    if (arr && arr[0]) {
      jsonAnswer = JSON.parse(arr[0].text);
    }
    log({
      msg: JSON.stringify(jsonAnswer),
      chatId,
      chatTitle: "http",
      username: "http",
      role: "assistant",
      logPath: HTTP_LOG_PATH,
    });
    const response = jsonAnswer || { text: result.content };
    log({
      msg: `Sending response: ${JSON.stringify(response).substring(0, 200)}`,
      chatId,
      chatTitle: "http",
      username: "http",
      role: "assistant",
      logPath: HTTP_LOG_PATH,
    });
    res.json(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({
      msg: `toolPostHandler error: ${msg}, result: ${JSON.stringify(result)}`,
      logLevel: "error",
      logPath: HTTP_LOG_PATH,
    });
    res.status(500).send(msg);
  }
}
