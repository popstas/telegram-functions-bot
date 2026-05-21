import { Context } from "telegraf";
import type { InlineQueryResultArticle } from "telegraf/types";
import type { Message } from "telegraf/types";
import { useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import { requestGptAnswer } from "../helpers/gpt/llm.ts";
import { useThreads } from "../threads.ts";
import type { ConfigChatType } from "../types.ts";

const DEFAULT_DEBOUNCE_MS = 1000;
const LIVE_RESULT_ID = "live";
// Telegram caps message text at 4096 characters.
const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

// Monotonic counter used to build a unique, throwaway thread id per inline run.
let inlineThreadCounter = 0;

// Cache of computed live answers keyed by query string. Bounded to avoid
// unbounded growth: each distinct query produces a new key, so without a cap
// the map would grow for the lifetime of the process. Oldest entries are
// evicted first (Map preserves insertion order).
const LIVE_ANSWER_CACHE_MAX = 500;
const liveAnswerCache = new Map<string, string>();

function setLiveAnswer(key: string, answer: string) {
  // Refresh insertion order so recently-used keys survive eviction.
  if (liveAnswerCache.has(key)) liveAnswerCache.delete(key);
  liveAnswerCache.set(key, answer);
  while (liveAnswerCache.size > LIVE_ANSWER_CACHE_MAX) {
    const oldest = liveAnswerCache.keys().next().value;
    if (oldest === undefined) break;
    liveAnswerCache.delete(oldest);
  }
}
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
  from: { id: number; first_name?: string } | undefined,
): Promise<string> {
  const chatConfig = buildInlineChatConfig(prompt);
  // Use an isolated, throwaway thread id. In a private chat Telegram sets
  // chat.id === user.id, so reusing from.id here would read from and write into
  // the user's real DM history. A unique synthetic key keeps inline runs
  // isolated and is removed in the finally block below.
  const inlineChatId = `inline:${from?.id ?? 0}:${inlineThreadCounter++}` as unknown as number;
  const threads = useThreads();
  const name = from?.first_name || "inline";
  const msg = {
    text: query,
    chat: { id: inlineChatId, type: "private", first_name: name },
    from: from || { id: 0, is_bot: false, first_name: "inline" },
    message_id: Date.now(),
    date: Math.floor(Date.now() / 1000),
  } as unknown as Message.TextMessage;

  // Seed the thread with the user's query. requestGptAnswer builds the prompt
  // from thread.messages (not msg.text), so without this the model would never
  // see what the user typed.
  threads[inlineChatId] = {
    id: inlineChatId,
    msgs: [],
    messages: query ? [{ role: "user", content: query, name }] : [],
    completionParams: chatConfig.completionParams,
  };

  try {
    const result = await requestGptAnswer(
      msg,
      chatConfig,
      { noSendTelegram: true } as Context & { noSendTelegram?: boolean },
      { skipEvaluators: true },
    );
    return result?.content || "";
  } finally {
    delete threads[inlineChatId];
  }
}

// Schedule a debounced live-answer computation for the given query.
// Cache key is scoped per user so one user's live answer is never surfaced to
// another user who happens to type the same query string.
function liveCacheKey(userId: number, query: string): string {
  return `${userId}:${query}`;
}

function scheduleLiveAnswer(
  query: string,
  from: { id: number; first_name?: string },
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
        if (answer) setLiveAnswer(liveCacheKey(from.id, query), answer);
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
  log({ msg: `inline query: "${query}" from ${inlineQuery.from?.id}, buttons=${buttons.length}` });

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

  let liveIncluded = false;
  if (config.inlineMode.live_answer && query) {
    const from = inlineQuery.from;
    const askPrompt = buttons.find((b) => b.name === "Ask")?.prompt || buttons[0]?.prompt || "";
    const cached = liveAnswerCache.get(liveCacheKey(from.id, query));
    if (cached) {
      results.unshift({
        type: "article",
        id: LIVE_RESULT_ID,
        title: "Live answer",
        description: cached.slice(0, 100),
        input_message_content: { message_text: cached },
      });
      liveIncluded = true;
    } else {
      scheduleLiveAnswer(
        query,
        from,
        askPrompt,
        config.inlineMode.debounce_ms || DEFAULT_DEBOUNCE_MS,
      );
    }
  }

  log({ msg: `inline query: answering ${results.length} results (live=${liveIncluded})` });
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
  log({
    msg: `inline chosen result: id=${result_id}, inline_message_id=${inline_message_id ? "yes" : "no"}, from=${from?.id}`,
  });
  if (!inline_message_id) {
    log({
      msg: "inline chosen result: no inline_message_id (set /setinlinefeedback to 100% in BotFather)",
      logLevel: "warn",
    });
    return;
  }

  if (result_id === LIVE_RESULT_ID) {
    log({ msg: "inline chosen result: live answer picked, nothing to compute" });
    return;
  }

  const match = /^btn:(\d+)$/.exec(result_id);
  if (!match) {
    log({ msg: `inline chosen result: unrecognized result_id "${result_id}"` });
    return;
  }
  const index = parseInt(match[1], 10);
  const buttons = getInlineButtons();
  const button = buttons[index];
  if (!button) {
    log({ msg: `inline chosen result: button index ${index} out of range` });
    return;
  }

  try {
    const answer = await computeInlineAnswer(button.prompt, query || "", from);
    const text = (answer || "(empty answer)").slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
    await ctx.telegram.editMessageText(undefined, undefined, inline_message_id, text);
    log({ msg: `inline answer delivered (${text.length} chars) for "${button.name}"` });
  } catch (e) {
    const message = (e as Error).message;
    log({ msg: `inline chosen result error: ${message}`, logLevel: "warn" });
    // Replace the ⏳ placeholder with an error so the user is not left waiting
    // forever. Guard the edit itself so a failed edit cannot throw out of here.
    try {
      const text = `Error: ${message}`.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH);
      await ctx.telegram.editMessageText(undefined, undefined, inline_message_id, text);
    } catch {
      // ignore — nothing more we can do to update the inline message
    }
  }
}

export default onInlineQuery;
