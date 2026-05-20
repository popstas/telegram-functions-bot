import { Context } from "telegraf";
import type { InlineQueryResultArticle } from "telegraf/types";
import type { Message } from "telegraf/types";
import { useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import { requestGptAnswer } from "../helpers/gpt/llm.ts";
import type { ConfigChatType } from "../types.ts";

const DEFAULT_DEBOUNCE_MS = 1000;
const LIVE_RESULT_ID = "live";

// Cache of computed live answers keyed by query string.
const liveAnswerCache = new Map<string, string>();
// Active debounce timers keyed by user id.
const liveTimers = new Map<number, NodeJS.Timeout>();

export function __resetInlineState() {
  liveAnswerCache.clear();
  for (const timer of liveTimers.values()) clearTimeout(timer);
  liveTimers.clear();
}

// Build the list of inline buttons, always including a default "Ask" button
// whose prompt defaults to the default chat's systemMessage.
export function getInlineButtons(): { name: string; prompt: string }[] {
  const config = useConfig();
  const buttons = config.inlineMode?.buttons ? [...config.inlineMode.buttons] : [];
  if (!buttons.some((b) => b.name === "Ask")) {
    const defaultChat = config.chats.find((c) => c.name === "default");
    buttons.unshift({ name: "Ask", prompt: defaultChat?.systemMessage || "" });
  }
  return buttons;
}

function buildInlineChatConfig(prompt: string): ConfigChatType {
  const config = useConfig();
  const defaultChat = config.chats.find((c) => c.name === "default");
  const base = defaultChat
    ? ({ ...defaultChat } as ConfigChatType)
    : ({
        name: "inline",
        completionParams: { model: "gpt-5-mini" },
        chatParams: {},
        toolParams: {},
      } as ConfigChatType);
  base.systemMessage = prompt;
  return base;
}

// Run a button prompt against the typed query through the LLM.
export async function computeInlineAnswer(
  prompt: string,
  query: string,
  from: { id: number; username?: string; first_name?: string } | undefined,
): Promise<string> {
  const chatConfig = buildInlineChatConfig(prompt);
  const chatId = from?.id || 0;
  const msg = {
    text: query,
    chat: { id: chatId, type: "private", first_name: from?.first_name || "inline" },
    from: from || { id: chatId, is_bot: false, first_name: "inline" },
    message_id: Date.now(),
    date: Math.floor(Date.now() / 1000),
  } as unknown as Message.TextMessage;

  const result = await requestGptAnswer(
    msg,
    chatConfig,
    { noSendTelegram: true } as Context & { noSendTelegram?: boolean },
    { skipEvaluators: true },
  );
  return result?.content || "";
}

// Schedule a debounced live-answer computation for the given query.
function scheduleLiveAnswer(
  query: string,
  from: { id: number; username?: string; first_name?: string },
  prompt: string,
  debounceMs: number,
) {
  const existing = liveTimers.get(from.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    liveTimers.delete(from.id);
    void (async () => {
      try {
        const answer = await computeInlineAnswer(prompt, query, from);
        if (answer) liveAnswerCache.set(query, answer);
      } catch (e) {
        log({ msg: `inline live answer error: ${(e as Error).message}`, logLevel: "warn" });
      }
    })();
  }, debounceMs);
  liveTimers.set(from.id, timer);
}

export async function onInlineQuery(ctx: Context) {
  const config = useConfig();
  if (!config.inlineMode) return;
  const inlineQuery = ctx.inlineQuery;
  if (!inlineQuery) return;

  const query = inlineQuery.query || "";
  const buttons = getInlineButtons();

  const results: InlineQueryResultArticle[] = buttons.map((button, index) => ({
    type: "article",
    id: `btn:${index}`,
    title: button.name,
    description: query ? `${button.name}: ${query}` : button.name,
    input_message_content: {
      message_text: query || button.name,
    },
    reply_markup: {
      inline_keyboard: [[{ text: "⏳", callback_data: "inline_noop" }]],
    },
  }));

  if (config.inlineMode.live_answer && query) {
    const from = inlineQuery.from;
    const askPrompt = buttons.find((b) => b.name === "Ask")?.prompt || buttons[0]?.prompt || "";
    const cached = liveAnswerCache.get(query);
    if (cached) {
      results.unshift({
        type: "article",
        id: LIVE_RESULT_ID,
        title: "Live answer",
        description: cached.slice(0, 100),
        input_message_content: { message_text: cached },
      });
    } else {
      scheduleLiveAnswer(
        query,
        from,
        askPrompt,
        config.inlineMode.debounce_ms || DEFAULT_DEBOUNCE_MS,
      );
    }
  }

  await ctx.answerInlineQuery(results, { cache_time: 0 });
}

export async function onChosenInlineResult(ctx: Context) {
  const config = useConfig();
  if (!config.inlineMode) return;
  const chosen = (
    ctx.update as {
      chosen_inline_result?: import("telegraf/types").Update.ChosenInlineResultUpdate["chosen_inline_result"];
    }
  ).chosen_inline_result;
  if (!chosen) return;

  const { result_id, query, inline_message_id, from } = chosen;
  if (!inline_message_id) return;

  if (result_id === LIVE_RESULT_ID) return;

  const match = /^btn:(\d+)$/.exec(result_id);
  if (!match) return;
  const index = parseInt(match[1], 10);
  const buttons = getInlineButtons();
  const button = buttons[index];
  if (!button) return;

  try {
    const answer = await computeInlineAnswer(button.prompt, query || "", from);
    await ctx.telegram.editMessageText(
      undefined,
      undefined,
      inline_message_id,
      answer || "(empty answer)",
    );
  } catch (e) {
    log({ msg: `inline chosen result error: ${(e as Error).message}`, logLevel: "warn" });
  }
}

export default onInlineQuery;
