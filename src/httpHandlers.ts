import type express from "express";
import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { useConfig } from "./config.ts";
import { log } from "./helpers.ts";
import { requestGptAnswer } from "./helpers/gpt/llm.ts";
import { resolveChatTools } from "./helpers/gpt/tools.ts";
import type { ThreadStateType } from "./types.ts";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
const version = pkg.version;

export async function agentGetHandler(
  req: express.Request,
  res: express.Response,
) {
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


export async function agentPostHandler(
  req: express.Request,
  res: express.Response,
) {
  const { agentName } = req.params;
  const { text, webhook } = req.body || {};
  const token = req.headers["authorization"];
  if (
    useConfig().http?.auth_token &&
    token !== `Bearer ${useConfig().http.auth_token}`
  ) {
    log({
      msg: "Unauthorized",
      logLevel: "warn",
    });
    return res.status(401).send("Unauthorized");
  }
  if (!text) {
    log({
      msg: "Message text is required.",
      logLevel: "warn",
    });
    return res.status(400).send("Message text is required.");
  }
  const agentConfig = useConfig().chats.find((c) => c.agent_name === agentName);
  if (!agentConfig) {
    log({
      msg: "Wrong agent_name",
      logLevel: "warn",
    });
    return res.status(400).send("Wrong agent_name");
  }
  const chatId =
    agentConfig.id ||
    parseInt("444" + Math.floor(100000 + Math.random() * 900000));
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
  });
  const resObj = await requestGptAnswer(msg, agentConfig, {
    noSendTelegram: true,
  } as unknown as Context);
  const answer = resObj?.content || "";
  log({
    msg: answer,
    chatId,
    chatTitle: "http",
    username: "http",
    role: "assistant",
  });
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

export async function toolPostHandler(
  req: express.Request,
  res: express.Response,
) {
  const { agentName, toolName } = req.params;
  const args = req.body || {};
  const token = req.headers["authorization"];
  if (
    useConfig().http?.auth_token &&
    token !== `Bearer ${useConfig().http.auth_token}`
  ) {
    log({
      msg: "Unauthorized",
      logLevel: "warn",
    });
    return res.status(401).send("Unauthorized");
  }
  const agentConfig = useConfig().chats.find((c) => c.agent_name === agentName);
  if (!agentConfig) {
    log({
      msg: "Wrong agent_name",
      logLevel: "warn",
    });
    return res.status(400).send("Wrong agent_name");
  }
  const chatId =
    agentConfig.id ||
    parseInt("666" + Math.floor(100000 + Math.random() * 900000));
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
      msg: "Wrong tool_name",
      logLevel: "warn",
    });
    return res.status(400).send("Wrong tool_name");
  }
  const fn = chatTool.module.call(agentConfig, thread).functions.get(toolName);
  const argsStr = typeof args === "string" ? args : JSON.stringify(args || {});
  log({
    msg: `${toolName}: ${argsStr}`,
    chatId,
    chatTitle: "http",
    username: "http",
    role: "user",
  });
  try {
    let jsonAnswer;
    const result = await fn(argsStr);
    const toolAnswer = JSON.parse(result.content);
    if (toolAnswer[0]) {
      jsonAnswer = JSON.parse(toolAnswer[0].text);
    }
    log({
      msg: JSON.stringify(jsonAnswer),
      chatId,
      chatTitle: "http",
      username: "http",
      role: "assistant",
    });
    if (jsonAnswer) {
      log({
        msg: "jsonAnswer",
        chatId,
        chatTitle: "http",
        username: "http",
        role: "assistant",
      });
      res.json(jsonAnswer);
    } else {
      log({
        msg: "result.content",
        chatId,
        chatTitle: "http",
        username: "http",
        role: "assistant",
      });
      res.end(result.content);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({
      msg,
      logLevel: "error",
    });
    res.status(500).send(msg);
  }
}
