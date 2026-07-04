# Telegraf → grammY Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Telegraf with grammY across the bot, moving the outbound send/streaming pipeline to Bot API 10.1 rich messages (`sendRichMessage` / `sendRichMessageDraft`) and deleting legacy edit-message streaming.

**Architecture:** One port branch, 23 sequenced tasks in 4 stages: (0) six Telegraf-safe pre-refactors that isolate every behavioral redesign while the suite stays green; (1–4) the grammY swap in dependency order — foundations (bot, synthetic contexts) → rich outbound pipeline (send, streaming) → lifecycle (runner, HTTP emulation) → handlers; then a full-green gate, docs, and a manual dev-bot smoke pass. Spec: `docs/superpowers/specs/2026-07-05-grammy-port-design.md`; per-surface mapping: `docs/superpowers/specs/2026-07-05-grammy-port-mapping.md`.

**Tech Stack:** TypeScript (ESM, Node 24), `grammy@^1.44` (`@grammyjs/types`, Bot API 10.1), `@grammyjs/runner`, `@grammyjs/auto-retry`, Jest 30 (`jest.unstable_mockModule` + dynamic `import()`), tsgo typecheck, eslint, prettier.

## Global Constraints

- **Suite-state rule:** Tasks 1–6 (Phase 0) MUST each end with `npm run test-full` fully green. Tasks 7–20 may leave the full suite/typecheck red (atomic swap), but each task MUST leave its own file-scoped tests green (`npm test -- <files>`); Task 21 is the full-green gate. Tasks 22–23 are docs/manual.
- **Dependencies:** add `grammy@^1.44`, `@grammyjs/runner`, `@grammyjs/auto-retry` (Task 7); remove `telegraf` (Task 21). No other new runtime deps. `telegramify-markdown` STAYS (legacy fallback path).
- **Locked names** (used across tasks — do not rename): `getRetryAfterMs`, `isBlockedByUser`, `isInvalidToken`, `getErrorDescription` (`src/telegram/errors.ts`); `withChatAction` (`src/telegram/chatAction.ts`); `registerConfirmActions`, `__testConfirm` (`src/telegram/confirm.ts`); `registerCommandActions` (`src/commands.ts`); `BotContext`, `BotFlavor`, `FLAVOR_KEYS`, `attachFlavor` (`src/telegram/botContext.ts`); `useBot`, `botReady`, `getBots` (`src/bot.ts`); `createNewContext` (`src/telegram/context.ts`); `setLastCtx`, `getLastApi` (`src/helpers/lastCtx.ts`); `createRichDraftFlusher`, `handleStream` (`src/helpers/gpt/streaming.ts`); alias types `TitleChat`, `MessageUpdate`, `EditedMessageUpdate`, `CallbackQueryUpdate`, `ChosenInlineResultUpdate`, `MessageReactionUpdate` (`src/telegram/updateTypes.ts`).
- **CLAUDE.md rules apply to every task:** update all `jest.unstable_mockModule` sites when a source module's imports change; update `toHaveBeenCalledWith` assertions when exported functions change parameters; never touch `data/` in tests; never edit `CHANGELOG.md`; config-type changes update `generateConfig()` full-example + README in the same commit.
- **Commit style:** Phase 0 `refactor(<area>): …`; port tasks `refactor(grammy): …`; `feat(…)` only for user-visible behavior change (rich sends, dropping edit streaming, streamMode removal). Every commit message ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Behavior parity everywhere EXCEPT** (approved): rich outbound pipeline (Tasks 10–13), answering `add_tool`/`add_skill` callback queries (Task 2), HTTP emulation working from boot (Task 15), draft `Date.now()` ids → monotonic counters (Tasks 1, 10).
- **Verified grammY API shapes** (from `@grammyjs/types` source; trust these): `api.editMessageText(chat_id, message_id, text, other?)` — no inline slot; `api.editMessageTextInline(inline_message_id, text, other?)`; `api.sendRichMessage(chat_id, rich_message, other)` with `other ⊇ { business_connection_id, message_thread_id, reply_parameters, reply_markup, disable_notification }` → `Message.RichMessageMessage`; `api.sendRichMessageDraft(chat_id, draft_id, rich_message, { message_thread_id? })` → `true`; `api.sendMessageDraft(chat_id, draft_id, text, other?)` — empty text allowed → `true`; `InputRichMessage = { markdown? | html?, is_rtl?, skip_entity_detection? }`; `GrammyError` fields top-level (`error_code`, `description`, `parameters?.retry_after`); `new Context(update, api, me)` — `ctx.message`/`ctx.chat`/`ctx.from` are getters over `update` (object spreads copy nothing).

## File Structure

New files:
- `src/telegram/errors.ts` — single home for Telegram error-shape parsing (Task 4; internals swapped to GrammyError in Task 11)
- `src/telegram/chatAction.ts` — `withChatAction` typing-indicator helper (Task 5; grammY re-impl Task 14)
- `src/telegram/updateTypes.ts` — narrow Update/Chat alias types (Task 6; internals swapped Task 7)
- `src/telegram/botContext.ts` — `BotContext` flavor + `attachFlavor` (Task 7)
- `tests/telegram/errors.test.ts`, `tests/telegram/chatAction.test.ts` — unit tests for the new helpers

Deleted code (not files): dynamic `bot.action` registration (confirm.ts, commands.ts); `Markup` usage; `createFlusher`/`createDraftFlusher`/`safeSend`/`safeEdit`/`safeDelete`/`safeSendDraft`/`getRetryAfter` in streaming.ts; `ChatParamsType.streamMode`; `history.ts` `forward_from` branch; `persistentChatAction` stubs.

---
## Phase 0 — Telegraf-safe pre-refactors (suite green after every task)

### Task 1: Static confirmation callbacks with pending map

**Files:**
- Modify: `src/telegram/confirm.ts` (full rewrite, stays on Telegraf)
- Modify: `src/index.ts` (register in `launchBot`)
- Test: `tests/telegram/confirm.test.ts`

**Interfaces:**
- Consumes: `sendTelegramMessage(chat_id, text, params, ctx, chatConfig)` from `src/telegram/send.ts` (unchanged).
- Produces: `registerConfirmActions(bot: Telegraf): void`, `telegramConfirm<T>(params): Promise<T>` (same public signature as today), `__testConfirm.reset()`. Task 12 later renames `bot.action`→`bot.callbackQuery` and `answerCbQuery`→`answerCallbackQuery` inside this file; Task 14 calls `registerConfirmActions` from the ported `launchBot`.

Problem being fixed: `telegramConfirm` registers two `bot.action(...)` handlers per confirmation at runtime (`src/telegram/confirm.ts:52-64`) — a handler leak on Telegraf and a hard runtime error on grammY (handler registration after `bot.start()` throws).

- [ ] **Step 1: Rewrite `src/telegram/confirm.ts`**

```ts
import { Telegraf, Context } from "telegraf";
import { Message } from "telegraf/types";
import { sendTelegramMessage } from "./send.ts";
import { ConfigChatType } from "../types.ts";

let nextConfirmId = 1;

type PendingConfirmation = {
  fromId?: number;
  onConfirm: () => unknown;
  onCancel: () => unknown;
  resolve: (res: unknown) => void;
};

const pendingConfirmations = new Map<number, PendingConfirmation>();

/**
 * Static handler for confirm_<id>/cancel_<id> buttons. Registered ONCE per bot at
 * startup (launchBot) instead of two dynamic bot.action() per confirmation.
 */
export function registerConfirmActions(bot: Telegraf): void {
  bot.action(/^(confirm|cancel)_(\d+)$/, async (ctx: Context & { match: RegExpExecArray }) => {
    const kind = ctx.match[1] as "confirm" | "cancel";
    const id = parseInt(ctx.match[2], 10);
    const pending = pendingConfirmations.get(id);
    if (!pending) {
      await ctx.answerCbQuery("Expired");
      return;
    }
    // Same guard as before: only the user the confirmation was sent for may answer.
    if (ctx.from?.id !== pending.fromId) return;
    await ctx.answerCbQuery();
    pendingConfirmations.delete(id);
    const res = kind === "confirm" ? await pending.onConfirm() : await pending.onCancel();
    pending.resolve(res);
  });
}

export async function telegramConfirm<T>(params: {
  chatId: number;
  msg: Message.TextMessage;
  chatConfig: ConfigChatType;
  text: string;
  onConfirm: () => Promise<T> | T;
  onCancel: () => Promise<T> | T;
  noSendTelegram?: boolean;
}): Promise<T> {
  const { chatId, msg, chatConfig, text, onConfirm, onCancel, noSendTelegram = false } = params;
  const id = nextConfirmId++;

  if (!noSendTelegram) {
    await sendTelegramMessage(
      chatId,
      text,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Yes", callback_data: `confirm_${id}` },
              { text: "No", callback_data: `cancel_${id}` },
            ],
          ],
        },
      },
      undefined,
      chatConfig,
    );
  }

  return new Promise<T>((resolve) => {
    pendingConfirmations.set(id, {
      fromId: msg.from?.id,
      onConfirm,
      onCancel,
      resolve: resolve as (res: unknown) => void,
    });
  });
}

export const __testConfirm = {
  reset() {
    pendingConfirmations.clear();
    nextConfirmId = 1;
  },
};

export default telegramConfirm;
```

Notes: id changes from `Date.now()` string to a monotonic counter (spec-approved — same-millisecond collision fix). `callback_data` format stays `confirm_<digits>`/`cancel_<digits>`.

- [ ] **Step 2: Register in `src/index.ts` `launchBot`**

After `await initCommands(bot);` (src/index.ts:112) add:

```ts
import { registerConfirmActions } from "./telegram/confirm.ts";
// ... inside launchBot, after initCommands:
registerConfirmActions(bot);
```

- [ ] **Step 3: Update `tests/telegram/confirm.test.ts`**

Read the current file. It mocks `src/bot.ts` `useBot` and captures dynamic `.action(name, handler)` registrations. Replace that harness with: a fake bot object `{ action: jest.fn() }` passed to `registerConfirmActions(fakeBot)` once per test; extract the single registered regex handler via `fakeBot.action.mock.calls[0][1]`; simulate clicks by invoking it with `{ match: ["confirm_1", "confirm", "1"], from: { id: <same id as msg.from.id> }, answerCbQuery: jest.fn() }`. Add `beforeEach` → `__testConfirm.reset()` (import it in the dynamic `import()` alongside `telegramConfirm`). Keep/port the existing behavioral cases; ensure these are covered:

```ts
it("resolves onConfirm result when confirm button clicked by the same user", ...);
it("resolves onCancel result when cancel clicked", ...);
it("ignores clicks from another user (does not resolve, keeps pending)", ...);
it("answers 'Expired' for unknown confirmation id", async () => {
  registerConfirmActions(fakeBot);
  const handler = fakeBot.action.mock.calls[0][1];
  const answerCbQuery = jest.fn();
  await handler({ match: ["confirm_99", "confirm", "99"], from: { id: 1 }, answerCbQuery });
  expect(answerCbQuery).toHaveBeenCalledWith("Expired");
});
it("skips sending when noSendTelegram is true but still resolves on click", ...);
it("sends inline keyboard with confirm_<id>/cancel_<id> callback_data", ...); // assert via mocked sendTelegramMessage args
```

- [ ] **Step 4: Run file-scoped tests, then full gate**

Run: `npm test -- tests/telegram/confirm.test.ts` → PASS.
Run: `npm run test-full` → PASS (this is Phase 0 — suite must stay green). Also grep for other dynamic registrations from this module: `grep -rn "telegramConfirm" src/ tests/` and confirm no caller passed/depended on the old `Date.now()` id format.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/confirm.ts src/index.ts tests/telegram/confirm.test.ts
git commit -m "refactor(confirm): static callback handlers with pending-confirmation map

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Static add_tool/add_skill callback handlers

**Files:**
- Modify: `src/commands.ts`
- Modify: `src/index.ts` (register in `launchBot`)
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `useTools()` (`src/helpers/useTools.ts`), `loadSkills()`, `skillToolName()` (`src/helpers/skills.ts`), `getActionUserMsg` (`src/telegram/context.ts`) — all unchanged.
- Produces: `registerCommandActions(bot: Telegraf): void`. `commandAddTool`/`commandAddSkill` keep their signatures but no longer register actions. Task 14 calls `registerCommandActions` from the ported `launchBot`; Task 16 later swaps the `Telegraf` type for `Bot<BotContext>`.

Problem: `commandAddTool` registers one `bot.action("add_tool_<name>")` per tool on EVERY `/add_tool` invocation (`src/commands.ts:139-192`), same for skills (`:231-269`). The `callback_data` already carries the tool/skill name — no map needed.

- [ ] **Step 1: Extract the click handlers and add `registerCommandActions`**

In `src/commands.ts`, lift the two closure bodies into module functions and register two static regex actions. The bodies are moved VERBATIM from the current closures (src/commands.ts:140-191 and :233-268) with these mechanical substitutions: `tool.name` → `toolName`, the outer `config` → `useConfig()` resolved inside, `tool.module.defaultParams` → resolved via lookup, and a final `answerCbQuery()` (approved improvement — today the buttons spin forever):

```ts
const EXCLUDED_TOOLS = ["change_chat_settings", "memory_add", "memory_delete", "memory_search"];

async function handleAddToolAction(ctx: Context, toolName: string) {
  const config = useConfig();
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  const { user } = getActionUserMsg(ctx);
  const username = user?.username || "without_username";
  if (!user || !includesUser(config.adminUsers, username)) return;

  const globalTools = await useTools();
  const tool = globalTools.find((t) => t.name === toolName);
  if (!tool) {
    await (ctx as Context & { answerCbQuery: (t?: string) => Promise<unknown> }).answerCbQuery(
      "Unknown tool",
    );
    return;
  }

  let chatConfig: ConfigChatType | undefined;
  if (ctx.chat?.type === "private") {
    chatConfig = config.chats.find((chat) => username && chat.username === username);
    if (!chatConfig) {
      chatConfig = generatePrivateChatConfig(username);
      config.chats.push(chatConfig);
    }
  } else {
    chatConfig = config.chats.find((chat) => chat.id === chatId || chat.ids?.includes(chatId));
    if (!chatConfig) {
      void ctx.reply("Chat not found in config");
    }
  }
  if (!chatConfig) return;

  if (!chatConfig.tools) chatConfig.tools = [];
  const hasTool = (chatConfig.tools || []).some((t) => typeof t === "string" && t === tool.name);
  if (!hasTool) chatConfig.tools.push(tool.name);
  chatConfig.tools = chatConfig.tools.filter((t) => {
    if (typeof t === "object" && ("agent_name" in t || "bot_name" in t)) return true;
    return !EXCLUDED_TOOLS.includes(t as string);
  });

  if (!chatConfig.toolParams) chatConfig.toolParams = {} as ToolParamsType;
  if (tool.module.defaultParams) {
    chatConfig.toolParams = { ...tool.module.defaultParams, ...chatConfig.toolParams };
  }
  writeConfig(undefined, config);
  await ctx.reply(
    `Tool added: ${tool.name}${tool.module.defaultParams ? `, with default config: ${JSON.stringify(tool.module.defaultParams)}` : ""}`,
  );
}

async function handleAddSkillAction(ctx: Context, toolName: string) {
  // Same shape: admin gate via getActionUserMsg; validate the skill still exists via
  // loadSkills().find((s) => skillToolName(s) === toolName) → answerCbQuery("Unknown skill")
  // if not; then the verbatim body of the current closure at src/commands.ts:234-267
  // (private/group chatConfig resolution, duplicate check with
  // `Skill already added: ${toolName}` reply, push + writeConfig +
  // `Skill added: ${toolName}` reply).
}

export function registerCommandActions(bot: Telegraf): void {
  bot.action(/^add_tool_(.+)$/, async (ctx) => {
    await handleAddToolAction(ctx, (ctx.match as RegExpExecArray)[1]);
    await ctx.answerCbQuery();
  });
  bot.action(/^add_skill_(.+)$/, async (ctx) => {
    await handleAddSkillAction(ctx, (ctx.match as RegExpExecArray)[1]);
    await ctx.answerCbQuery();
  });
}
```

Write `handleAddSkillAction` out in full by transplanting src/commands.ts:234-267 exactly as `handleAddToolAction` transplants :141-190 (the comment block above tells you which lines; the logic is already written — move it, don't re-derive it). Then DELETE both `for (const tool of globalTools) { useBot(...).action(...) }` loops and the `useBot` import if now unused (`grep -n "useBot" src/commands.ts`). Deduplicate `excluded` (line 133) against the new `EXCLUDED_TOOLS` const.

- [ ] **Step 2: Register in `src/index.ts` `launchBot`**

Next to Task 1's registration: `registerCommandActions(bot);` (import from `./commands.ts`).

- [ ] **Step 3: Update `tests/commands.test.ts`**

Read the add_tool/add_skill test sections. Any test that captured dynamic `useBot().action` registrations switches to: `registerCommandActions(fakeBot)` where `fakeBot = { action: jest.fn() }`; pick handlers from `fakeBot.action.mock.calls` by regex source (`.find(([re]) => re.source.startsWith("^add_tool_"))`); invoke with `{ match: ["add_tool_ssh_command", "ssh_command"], chat: {...}, reply: jest.fn(), answerCbQuery: jest.fn(), update: { callback_query: { from: adminUser, message: {...} } } }` (the `update.callback_query` shape feeds `getActionUserMsg`). Assert: config written with tool added, reply text `Tool added: ...`, and `answerCbQuery` called (new behavior). Add one case: clicking `add_tool_nonexistent` → `answerCbQuery("Unknown tool")`, no config write.

- [ ] **Step 4: Run gates**

Run: `npm test -- tests/commands.test.ts` → PASS. Then `npm run test-full` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands.ts src/index.ts tests/commands.test.ts
git commit -m "refactor(commands): static add_tool/add_skill callback handlers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Replace Telegraf Markup with raw reply_markup literals

**Files:**
- Modify: `src/handlers/formFlow.ts`, `src/handlers/onTextMessage.ts`, `src/telegram/send.ts` (type-only)
- Test: `tests/handlers/onTextMessageAnswer.test.ts` (keyboard assertions), formFlow tests (`grep -rln "buildFormButtons\|handleFormButtonClick" tests/`)

**Interfaces:**
- Produces: `buildReplyKeyboard(names: string[]): { reply_markup: ReplyKeyboardMarkup }` (local helper in `src/handlers/onTextMessage.ts`); `buildFormButtons(...)` in formFlow.ts now returns `{ reply_markup: { inline_keyboard: {text: string; callback_data: string}[][] } } | undefined` (same JSON as before — Telegraf's `Markup.inlineKeyboard(x)` is exactly `{ reply_markup: { inline_keyboard: x } }`). `sendTelegramMessage`/`editTelegramMessage` `extraMessageParams` param becomes plain `Record<string, unknown>`.

- [ ] **Step 1: Characterize the current reply-keyboard JSON**

Telegraf's `Markup.keyboard(names).resize()` wrapper must be reproduced byte-identically. Run:

```bash
node --input-type=module -e 'import { Markup } from "telegraf"; console.log(JSON.stringify(Markup.keyboard(["a","b","c"]).resize()))'
```

Record the exact output (expected shape: `{"reply_markup":{"keyboard":<rows>,"resize_keyboard":true}}` — the command tells you whether `<rows>` is `[["a","b","c"]]` or one-per-row `[["a"],["b"],["c"]]`).

- [ ] **Step 2: Add `buildReplyKeyboard` to `src/handlers/onTextMessage.ts` and replace the 3 sites**

```ts
import type { ReplyKeyboardMarkup } from "telegraf/types";

function buildReplyKeyboard(names: string[]): { reply_markup: ReplyKeyboardMarkup } {
  // Same JSON as Telegraf's Markup.keyboard(names).resize() — verified in Task 3 Step 1.
  return {
    reply_markup: {
      keyboard: /* rows exactly as recorded in Step 1 */ names.map((n) => [{ text: n }]),
      resize_keyboard: true,
    },
  };
}
```

If Step 1 printed a single row, use `keyboard: [names.map((n) => ({ text: n }))]` instead — match the recorded output, then delete the placeholder comment. Replace:
- `src/handlers/onTextMessage.ts:462`: `const extraParams = Markup.keyboard(buttons.map((b) => b.name)).resize();` → `const extraParams = buildReplyKeyboard(buttons.map((b) => b.name));`
- `:523`: `const extraParamsButtons = Markup.keyboard(...).resize()` → `buildReplyKeyboard(buttons.map((b) => b.name))` (the following `Object.assign(extraParams, extraParamsButtons)` works unchanged — same `{reply_markup}` shape).
- `:613`: `...Markup.keyboard(generatedButtons.map((b) => b.name)).resize(),` → `...buildReplyKeyboard(generatedButtons.map((b) => b.name)),`
- Remove `Markup` from the line-1 import.

- [ ] **Step 3: formFlow.ts — raw inline keyboard**

`buildFormButtons` (src/handlers/formFlow.ts:438-477): change the return statement and annotation only — the `buttons` array is already the raw rows:

```ts
function buildFormButtons(
  form: FormConfigType,
  state: FormStateType,
): { reply_markup: { inline_keyboard: { text: string; callback_data: string }[][] } } | undefined {
  // ... body unchanged ...
  return buttons.length > 0 ? { reply_markup: { inline_keyboard: buttons } } : undefined;
}
```

The three consumer sites (`{...extraParams, ...buttons}` at :72 and :142, `ctx.editMessageText(statusMessage, buttons)` at :248) keep working — the object has the identical `{reply_markup}` shape. Remove `Markup` from the line-1 import.

- [ ] **Step 4: send.ts signature retype**

`src/telegram/send.ts:66` and `:215`: `extraMessageParams?: Record<string, unknown> | Markup.Markup<ReplyKeyboardMarkup>` → `extraMessageParams?: Record<string, unknown>`. Remove `Markup` from the import at line 13 (keep `Context, Input`).

- [ ] **Step 5: Run gates**

`grep -rn "Markup" src/` → 0 matches. Run keyboard-asserting tests: `npm test -- tests/handlers/onTextMessageAnswer.test.ts` → PASS (assertions at :246-248 and :321-328 compare raw reply_markup JSON — if Step 1's shape was recorded correctly they pass unchanged; if one fails, your Step 2 shape is wrong — fix the helper, not the test). Then `npm run test-full` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/formFlow.ts src/handlers/onTextMessage.ts src/telegram/send.ts
git commit -m "refactor(telegram): replace Markup helpers with raw reply_markup literals

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Extract error-shape helper `src/telegram/errors.ts`

**Files:**
- Create: `src/telegram/errors.ts`
- Modify: `src/helpers/gpt/streaming.ts`, `src/telegram/send.ts`, `src/index.ts`, `src/helpers/vision.ts`
- Test: Create `tests/telegram/errors.test.ts`

**Interfaces:**
- Produces (LOCKED — Task 11/12/14 swap only the internals to GrammyError):
  `getRetryAfterMs(err: unknown): number | undefined`, `isBlockedByUser(err: unknown): boolean`, `isInvalidToken(err: unknown): boolean`, `getErrorDescription(err: unknown): string`.

- [ ] **Step 1: Write the failing test `tests/telegram/errors.test.ts`**

```ts
import { jest, describe, it, expect } from "@jest/globals";
const { getRetryAfterMs, isBlockedByUser, isInvalidToken, getErrorDescription } = await import(
  "../../src/telegram/errors.ts"
);

describe("telegram/errors (telegraf shapes)", () => {
  it("getRetryAfterMs reads 429 retry_after in ms", () => {
    const err = { response: { error_code: 429, parameters: { retry_after: 5 } } };
    expect(getRetryAfterMs(err)).toBe(5000);
    expect(getRetryAfterMs({ response: { error_code: 400 } })).toBeUndefined();
    expect(getRetryAfterMs(new Error("x"))).toBeUndefined();
  });
  it("isBlockedByUser detects 403", () => {
    expect(isBlockedByUser({ response: { error_code: 403, description: "Forbidden: bot was blocked by the user" } })).toBe(true);
    expect(isBlockedByUser({ response: { error_code: 400 } })).toBe(false);
  });
  it("isInvalidToken detects 401 via statusCode or error_code", () => {
    expect(isInvalidToken({ response: { statusCode: 401 } })).toBe(true);
    expect(isInvalidToken({ response: { error_code: 401 } })).toBe(true);
    expect(isInvalidToken(new Error("nope"))).toBe(false);
  });
  it("getErrorDescription prefers response.description, falls back to message", () => {
    expect(getErrorDescription({ response: { description: "wrong file_id" } })).toBe("wrong file_id");
    expect(getErrorDescription(new Error("boom"))).toBe("boom");
    expect(getErrorDescription("weird")).toBe("weird");
  });
});
```

Run: `npm test -- tests/telegram/errors.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `src/telegram/errors.ts` (Telegraf internals)**

```ts
type TelegrafErrShape = {
  message?: string;
  response?: {
    error_code?: number;
    statusCode?: number;
    description?: string;
    parameters?: { retry_after?: number };
  };
};

export function getRetryAfterMs(err: unknown): number | undefined {
  const e = err as TelegrafErrShape;
  if (e?.response?.error_code === 429 && e.response.parameters?.retry_after) {
    return e.response.parameters.retry_after * 1000;
  }
  return undefined;
}

export function isBlockedByUser(err: unknown): boolean {
  return (err as TelegrafErrShape)?.response?.error_code === 403;
}

export function isInvalidToken(err: unknown): boolean {
  const e = err as TelegrafErrShape;
  return e?.response?.statusCode === 401 || e?.response?.error_code === 401;
}

export function getErrorDescription(err: unknown): string {
  const e = err as TelegrafErrShape;
  if (e?.response?.description) return e.response.description;
  if (e?.message) return e.message;
  return String(err);
}
```

Run: `npm test -- tests/telegram/errors.test.ts` → PASS.

- [ ] **Step 3: Switch the four call-site groups**

1. `src/helpers/gpt/streaming.ts`: delete local `getRetryAfter` (lines 9-17); `import { getRetryAfterMs } from "../../telegram/errors.ts";` and replace the four `const wait = getRetryAfter(err)` with `getRetryAfterMs(err)`. First check `grep -rn "getRetryAfter" src/ tests/` — if `tests/helpers/streaming.test.ts` imports it, keep `export const getRetryAfter = getRetryAfterMs;` as a bridge (deleted in Task 10).
2. `src/telegram/send.ts:159`: `if (error?.response?.error_code === 403)` → `if (isBlockedByUser(e))`; the two `error.response?.description || "Unknown error"` log interpolations → `getErrorDescription(e)`; delete the local `TelegramError` interface if now unused (`grep -n "TelegramError" src/telegram/send.ts` — it's also used in `sendTelegramDocument`, switch that log line too).
3. `src/index.ts:198-204`: replace the `"response" in error` + `statusCode === 401` probe with `if (isInvalidToken(error))`.
4. `src/helpers/vision.ts:32`: `err.message.includes("wrong file_id") || err.message.includes("temporarily unavailable")` → `const d = getErrorDescription(error); if (d.includes("wrong file_id") || d.includes("temporarily unavailable"))`.

- [ ] **Step 4: Run gates**

`npm test -- tests/telegram/errors.test.ts tests/helpers/streaming.test.ts tests/helpers/vision.test.ts tests/telegram/send.test.ts` → PASS, then `npm run test-full` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/errors.ts tests/telegram/errors.test.ts src/helpers/gpt/streaming.ts src/telegram/send.ts src/index.ts src/helpers/vision.ts
git commit -m "refactor(telegram): extract error-shape parsing into errors.ts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Extract `withChatAction` helper, delete persistentChatAction stubs

**Files:**
- Create: `src/telegram/chatAction.ts`
- Modify: `src/handlers/onTextMessage.ts` (3 sites), `src/handlers/onAudio.ts` (1), `src/helpers/vision.ts` (1), `src/index.ts` (delete stub), `src/handlers/onBusinessMessage.ts` (delete stub)
- Test: Create `tests/telegram/chatAction.test.ts`; adjust only tests that ASSERT `persistentChatAction` call shape (`grep -rln "persistentChatAction" tests/`)

**Interfaces:**
- Produces (LOCKED): `withChatAction<T>(ctx: unknown, action: string, fn: () => Promise<T>): Promise<T>`. Task 14 re-implements the internals for grammY (sendChatAction interval); call sites never change again.

- [ ] **Step 1: Failing test `tests/telegram/chatAction.test.ts`**

```ts
import { jest, describe, it, expect } from "@jest/globals";
const { withChatAction } = await import("../../src/telegram/chatAction.ts");

describe("withChatAction (telegraf phase)", () => {
  it("delegates to ctx.persistentChatAction and returns fn result", async () => {
    const calls: string[] = [];
    const ctx = {
      persistentChatAction: async (action: string, cb: () => Promise<void>) => {
        calls.push(action);
        await cb();
      },
    };
    const res = await withChatAction(ctx, "typing", async () => 42);
    expect(res).toBe(42);
    expect(calls).toEqual(["typing"]);
  });
  it("runs fn directly when ctx has no persistentChatAction (synthetic ctx)", async () => {
    const res = await withChatAction({}, "typing", async () => "ok");
    expect(res).toBe("ok");
  });
  it("propagates fn rejection", async () => {
    await expect(withChatAction({}, "typing", async () => { throw new Error("boom"); }))
      .rejects.toThrow("boom");
  });
});
```

Run: `npm test -- tests/telegram/chatAction.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `src/telegram/chatAction.ts`**

```ts
type PersistentChatActionCtx = {
  persistentChatAction?: (action: string, cb: () => Promise<void>) => Promise<void>;
};

/**
 * Keeps a chat action ("typing", "upload_photo", ...) visible while fn runs.
 * Telegraf phase: delegates to ctx.persistentChatAction when present; synthetic
 * contexts (HTTP/MQTT/business) simply run fn. Re-implemented on grammY in the port.
 */
export async function withChatAction<T>(
  ctx: unknown,
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const c = ctx as PersistentChatActionCtx;
  if (typeof c?.persistentChatAction === "function") {
    let result!: T;
    let failed: unknown;
    let didFail = false;
    await c.persistentChatAction(action, async () => {
      try {
        result = await fn();
      } catch (e) {
        didFail = true;
        failed = e;
      }
    });
    if (didFail) throw failed;
    return result;
  }
  return await fn();
}
```

(The inner try/catch matters: Telegraf's `persistentChatAction` would otherwise swallow the timing of a rejection; tests above pin this.) Run: `npm test -- tests/telegram/chatAction.test.ts` → PASS.

- [ ] **Step 3: Switch the six call sites**

Import `withChatAction` in each file, then:
- `src/handlers/onTextMessage.ts:448` and `:472`: `await ctx.persistentChatAction("typing", async () => { ... })` → `await withChatAction(ctx, "typing", async () => { ... })`; `:565`: `await ctx.persistentChatAction("typing", async () => {});` → `await withChatAction(ctx, "typing", async () => {});`
- `src/handlers/onAudio.ts:142`: → `await withChatAction(ctx, "typing", async () => processAudio(ctx, voice, chatId));`
- `src/helpers/vision.ts:136`: → `await withChatAction(ctx, uploadAction, run);`
- `src/index.ts:359-363`: delete the whole `persistentChatAction: async (...) => {...},` property from the virtual ctx object.
- `src/handlers/onBusinessMessage.ts`: `grep -n "persistentChatAction" src/handlers/onBusinessMessage.ts`, delete the stub property there the same way.

- [ ] **Step 4: Run gates**

`grep -rn "persistentChatAction" src/` → only `src/telegram/chatAction.ts` remains. Handler tests still pass because their ctx fakes' `persistentChatAction` stubs are now invoked THROUGH the helper (same call shape — e.g. the assertion in `tests/handlers/onAudioMain.test.ts` keeps passing). Run `npm run test-full` → PASS. If a test faked a ctx WITHOUT `persistentChatAction` and previously crashed-or-skipped, behavior is now "runs fn" — fix any such test expecting a crash.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/chatAction.ts tests/telegram/chatAction.test.ts src/handlers/onTextMessage.ts src/handlers/onAudio.ts src/helpers/vision.ts src/index.ts src/handlers/onBusinessMessage.ts
git commit -m "refactor(telegram): extract withChatAction helper, drop persistentChatAction stubs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Update-type alias file + dead `forward_from` branch

**Files:**
- Create: `src/telegram/updateTypes.ts`
- Modify: every file using Telegraf-only namespace types (enumerate with the grep below), `src/helpers/history.ts`
- Test: `tests/helpers/history.test.ts` (if it covers forward_from)

**Interfaces:**
- Produces (LOCKED): type exports `TitleChat`, `MessageUpdate`, `EditedMessageUpdate`, `CallbackQueryUpdate`, `ChosenInlineResultUpdate`, `MessageReactionUpdate` from `src/telegram/updateTypes.ts`. Task 7 swaps the internals to grammY indexed-access types; the ~20 consumer sites never change again.

- [ ] **Step 1: Create `src/telegram/updateTypes.ts` (Telegraf internals)**

```ts
import type { Chat, Update } from "telegraf/types";

// Narrowed Bot API types that Telegraf ships as namespace members but grammY does
// not. Consumers import these aliases; the port only swaps this file's internals.
export type TitleChat = Chat.TitleChat;
export type MessageUpdate = Update.MessageUpdate;
export type EditedMessageUpdate = Update.EditedMessageUpdate;
export type CallbackQueryUpdate = Update.CallbackQueryUpdate;
export type ChosenInlineResultUpdate = Update.ChosenInlineResultUpdate;
export type MessageReactionUpdate = Update.MessageReactionUpdate;
```

- [ ] **Step 2: Point every consumer site at the aliases**

Enumerate: `grep -rnE "Chat\.TitleChat|Update\.(Message|EditedMessage|CallbackQuery|ChosenInlineResult|MessageReaction)Update" src/`. For each hit (expected files: `src/telegram/context.ts`, `src/handlers/onPhoto.ts`, `src/handlers/onReaction.ts`, `src/handlers/onInlineQuery.ts`, `src/handlers/access.ts`, `src/handlers/formFlow.ts`, `src/handlers/onTextMessage.ts`, `src/helpers/gpt/tools.ts`, `src/helpers/gpt/llm.ts`): add `import type { TitleChat, ... } from "<rel>/telegram/updateTypes.ts";` (only the names that file uses) and replace `Chat.TitleChat` → `TitleChat`, `Update.MessageUpdate` → `MessageUpdate`, etc. Then remove `Chat`/`Update` from the file's `telegraf/types` import IF no longer referenced (`grep -n "Chat\.\|Update\." <file>` per file).

- [ ] **Step 3: Delete the dead forwarded-message branch in history.ts**

`grep -n "forward_from" src/helpers/history.ts src/ -r` — `forward_from` was removed from the Bot API (replaced by `forward_origin`, which `send.ts getFullName` already handles). Delete the `forward_from` branch in `src/helpers/history.ts` (around line 27) and any type it carried. If `grep -rn "forward_from" tests/` shows a test exercising it, delete that test case in the same commit.

- [ ] **Step 4: Run gates**

`grep -rnE "Chat\.TitleChat|Update\.[A-Za-z]+Update" src/` → only `src/telegram/updateTypes.ts`. `npm run test-full` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/updateTypes.ts src/ tests/
git commit -m "refactor(types): centralize narrowed update types; drop dead forward_from branch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
## Phase 1 — grammY foundations (full suite MAY be red from here until Task 21; each task keeps its own file-scoped tests green)

### Task 7: Install grammY, BotContext flavor, repo-wide type-import swap

**Files:**
- Modify: `package.json` (+lockfile)
- Create: `src/telegram/botContext.ts`
- Modify: `src/telegram/updateTypes.ts` (internals), every file importing `telegraf/types` (~40, via script)
- Test: the 15 phantom-import test files (import fix only)

**Interfaces:**
- Produces (LOCKED): `BotFlavor`, `BotContext = Context & BotFlavor`, `FLAVOR_KEYS`, `attachFlavor(from: Partial<BotFlavor>, to: Context): BotContext` from `src/telegram/botContext.ts`. All later tasks type contexts as `BotContext`.

- [ ] **Step 1: Install dependencies**

```bash
npm install grammy@^1.44 @grammyjs/runner @grammyjs/auto-retry
```

Verify: `node --input-type=module -e 'import { Bot, Context, GrammyError } from "grammy"; import { run, sequentialize } from "@grammyjs/runner"; import { autoRetry } from "@grammyjs/auto-retry"; console.log("ok")'` → `ok`. Also verify the Bot API 10.1 methods exist in the installed types: `grep -rn "sendRichMessageDraft" node_modules/@grammyjs/types/methods.d.ts` → 1+ match (if absent, bump grammy until present — the spec requires Bot API 10.1 typings).

- [ ] **Step 2: Create `src/telegram/botContext.ts`**

```ts
import { Context } from "grammy";
import type { Response } from "express";

/** App-level props layered onto grammY's Context (former ad-hoc intersection casts). */
export interface BotFlavor {
  secondTry?: boolean;
  businessConnectionId?: string;
  businessOwnerUsername?: string;
  expressRes?: Response;
  noSendTelegram?: boolean;
  progressCallback?: (msg: string) => void;
}

export type BotContext = Context & BotFlavor;

export const FLAVOR_KEYS = [
  "secondTry",
  "businessConnectionId",
  "businessOwnerUsername",
  "expressRes",
  "noSendTelegram",
  "progressCallback",
] as const satisfies readonly (keyof BotFlavor)[];

/** Copy flavor props onto a (usually freshly constructed) Context. */
export function attachFlavor(from: Partial<BotFlavor>, to: Context): BotContext {
  const target = to as BotContext;
  for (const key of FLAVOR_KEYS) {
    const value = from[key];
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}
```

- [ ] **Step 3: Repo-wide `telegraf/types` → `grammy/types` swap**

```bash
grep -rl 'from "telegraf/types"' src tests | xargs sed -i 's|from "telegraf/types"|from "grammy/types"|g'
```

Then fix the 15 phantom `Context` imports (they imported a nonexistent `Context` from telegraf/types; grammY's types package has none either, but the correct source is the `grammy` package):

```bash
grep -rln 'import { Context } from "grammy/types"' tests/ | xargs sed -i 's|import { Context } from "grammy/types";|import type { Context } from "grammy";|'
grep -rn 'Context' tests/ | grep 'from "grammy/types"'   # any remaining combined imports:
```

For each remaining combined line like `import { Context, Message } from "grammy/types";` split it into `import type { Context } from "grammy";` + `import { Message } from "grammy/types";`. Verify zero left: `grep -rn '\bContext\b.*from "grammy/types"' src tests` → 0.

- [ ] **Step 4: Swap `src/telegram/updateTypes.ts` internals**

```ts
import type { Chat, Update } from "grammy/types";

export type TitleChat = Exclude<Chat, Chat.PrivateChat>;
export type MessageUpdate = Update & Required<Pick<Update, "message">>;
export type EditedMessageUpdate = Update & Required<Pick<Update, "edited_message">>;
export type CallbackQueryUpdate = Update & Required<Pick<Update, "callback_query">>;
export type ChosenInlineResultUpdate = Update & Required<Pick<Update, "chosen_inline_result">>;
export type MessageReactionUpdate = Update & Required<Pick<Update, "message_reaction">>;
```

- [ ] **Step 5: Sanity-run a types-only consumer's tests**

Run: `npm test -- tests/helpers/history.test.ts tests/helpers/access.test.ts` → PASS (type-only changes; runtime untouched). NOTE: `npm run typecheck` is EXPECTED to fail from here (src still imports `Context` from "telegraf" elsewhere) — do not chase those until their tasks.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src tests
git commit -m "refactor(grammy): install grammy, add BotContext flavor, swap type imports

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Port `src/bot.ts`

**Files:**
- Modify: `src/bot.ts` (full rewrite)
- Test: `tests/bot.test.ts` (full rewrite — the only file that mocks the framework package)

**Interfaces:**
- Consumes: `BotContext` (Task 7).
- Produces (LOCKED): `useBot(bot_token?): Bot<BotContext>` (sync, cached per token), `botReady(bot_token?): Promise<void>`, `getBots(): Record<string, Bot<BotContext>>`, `setRunnerHandle(token: string, handle: RunnerHandle): void`, `getRunnerHandles(): Record<string, RunnerHandle>` (handles registry used by Task 14 index.ts and Task 15 healthcheck).

- [ ] **Step 1: Rewrite `src/bot.ts`**

```ts
import { Bot } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { RunnerHandle } from "@grammyjs/runner";
import { HttpsProxyAgent } from "https-proxy-agent";
import { useConfig } from "./config.ts";
import type { BotContext } from "./telegram/botContext.ts";

const bots: Record<string, Bot<BotContext>> = {};
const initPromises: Record<string, Promise<void>> = {};
const runnerHandles: Record<string, RunnerHandle> = {};

export function useBot(bot_token?: string): Bot<BotContext> {
  const config = useConfig();
  const token = bot_token || config.auth.bot_token;
  if (!bots[token]) {
    const proxyUrl = config.auth.proxy_url;
    const bot = new Bot<BotContext>(
      token,
      proxyUrl
        ? { client: { baseFetchConfig: { agent: new HttpsProxyAgent(proxyUrl), compress: true } } }
        : undefined,
    );
    // Centralized 429 handling for ALL outbound calls (incl. rich drafts).
    bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
    bots[token] = bot;
    // botInfo: grammY forbids assignment (throwing getter before init) — run init
    // eagerly; launch/HTTP paths await botReady() before reading bot.botInfo.
    const init = bot.init();
    initPromises[token] = init;
    init.catch(() => {
      // surfaced via botReady() awaiters (e.g. 401 in launchBot); avoid unhandledRejection
      delete bots[token];
      delete initPromises[token];
    });
    process.once("SIGINT", () => void bots[token]?.stop().catch(() => {}));
    process.once("SIGTERM", () => void bots[token]?.stop().catch(() => {}));
  }
  return bots[token];
}

export function botReady(bot_token?: string): Promise<void> {
  const token = bot_token || useConfig().auth.bot_token;
  useBot(token);
  return initPromises[token] ?? Promise.reject(new Error(`bot init failed for token`));
}

export function getBots(): Record<string, Bot<BotContext>> {
  return bots;
}

export function setRunnerHandle(token: string, handle: RunnerHandle): void {
  runnerHandles[token] = handle;
}

export function getRunnerHandles(): Record<string, RunnerHandle> {
  return runnerHandles;
}
```

> Note: `bot.stop()` on a never-started bot rejects — the `.catch(() => {})` in the signal handlers preserves today's "best effort" semantics.

- [ ] **Step 2: Rewrite `tests/bot.test.ts`**

```ts
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const botInstances: FakeBot[] = [];
class FakeBot {
  token: string;
  options: unknown;
  api = { config: { use: jest.fn() } };
  init = jest.fn(async () => {});
  stop = jest.fn(async () => {});
  constructor(token: string, options?: unknown) {
    this.token = token;
    this.options = options;
    botInstances.push(this);
  }
}

jest.unstable_mockModule("grammy", () => ({ Bot: FakeBot }));
jest.unstable_mockModule("@grammyjs/auto-retry", () => ({
  autoRetry: jest.fn(() => "auto-retry-transformer"),
}));
jest.unstable_mockModule("../src/config.ts", () => ({
  useConfig: jest.fn(() => ({ auth: { bot_token: "tok-1", proxy_url: "" } })),
  readConfig: jest.fn(),
}));

const { useBot, botReady, getBots, setRunnerHandle, getRunnerHandles } = await import("../src/bot.ts");
const { useConfig } = await import("../src/config.ts");

describe("useBot (grammy)", () => {
  beforeEach(() => { botInstances.length = 0; });

  it("creates one Bot per token and caches it", () => {
    const a = useBot("t1");
    expect(useBot("t1")).toBe(a);
    expect(useBot("t2")).not.toBe(a);
  });

  it("installs the auto-retry transformer and starts init", async () => {
    useBot("t3");
    const inst = botInstances.find((b) => b.token === "t3")!;
    expect(inst.api.config.use).toHaveBeenCalledWith("auto-retry-transformer");
    expect(inst.init).toHaveBeenCalled();
    await expect(botReady("t3")).resolves.toBeUndefined();
  });

  it("passes proxy agent via client.baseFetchConfig when proxy_url set", () => {
    (useConfig as jest.Mock).mockReturnValue({ auth: { bot_token: "tok-p", proxy_url: "http://proxy:3128" } });
    useBot("tok-proxy");
    const inst = botInstances.find((b) => b.token === "tok-proxy")!;
    const opts = inst.options as { client: { baseFetchConfig: { agent: unknown; compress: boolean } } };
    expect(opts.client.baseFetchConfig.agent).toBeDefined();
    expect(opts.client.baseFetchConfig.compress).toBe(true);
  });

  it("stores and returns runner handles", () => {
    const handle = { isRunning: () => true } as never;
    setRunnerHandle("t1", handle);
    expect(getRunnerHandles()["t1"]).toBe(handle);
  });

  it("getBots exposes the registry", () => {
    useBot("t9");
    expect(Object.keys(getBots())).toContain("t9");
  });
});
```

Adapt the default-token and SIGINT cases from the OLD file if present (read it before deleting): the constructor-args assertion `{ telegram: { agent } }` is replaced by the `client.baseFetchConfig` case above; `telegram.getMe` no longer exists — init covers it.

- [ ] **Step 3: Run**

`npm test -- tests/bot.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/bot.ts tests/bot.test.ts
git commit -m "refactor(grammy): port bot factory — Bot<BotContext>, init, auto-retry, proxy via baseFetchConfig

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Port synthetic contexts — `context.ts` + `lastCtx.ts` (keystone)

**Files:**
- Modify: `src/telegram/context.ts`, `src/helpers/lastCtx.ts`
- Test: `tests/telegram/context.test.ts`

**Interfaces:**
- Consumes: `attachFlavor`, `BotContext` (Task 7).
- Produces: `createNewContext(ctx: BotContext, newMsg: Message): BotContext` (real grammY Context construction — five re-dispatch paths depend on it); `setLastCtx(ctx: BotContext)`, `getLastApi(): { api: Api; me: UserFromGetMe } | undefined`, plus TEMPORARY `useLastCtx()` kept until Task 15 removes its last consumer.

- [ ] **Step 1: Port `src/telegram/context.ts`**

Imports become:

```ts
import { Chat, Message, Update, User, UserFromGetMe } from "grammy/types";
import { Context } from "grammy";
import { attachFlavor, BotContext } from "./botContext.ts";
import type { CallbackQueryUpdate, EditedMessageUpdate, MessageUpdate, TitleChat } from "./updateTypes.ts";
```

Three code changes (rest of the file — `isAccessAllowed`, `getChatConfig` merge logic — is untouched):
1. `getChatConfig` line 57: `ctx.botInfo.username` → `ctx.me.username`.
2. `getActionUserMsg`/`getCtxChatMsg`: keep the `Object.prototype.hasOwnProperty.call(ctx, "update")` guards (grammY's `update` is an own constructor property on real contexts, and test literals set it as an own prop — both still pass the check). The casts now use the Task 6 aliases (`CallbackQueryUpdate`, `EditedMessageUpdate`, `MessageUpdate`) — already done in Task 6, only the import source changed in Task 7.
3. Replace `createNewContext` (lines 159-169):

```ts
export function createNewContext(ctx: BotContext, newMsg: Message): BotContext {
  // grammY ctx.message/chat/from are getters over ctx.update — descriptor cloning
  // copies nothing. Build a real Context around the substituted update instead.
  const update = { ...ctx.update, message: newMsg } as Update;
  const fresh = new Context(update, ctx.api, ctx.me);
  return attachFlavor(ctx, fresh);
}
```

- [ ] **Step 2: Port `src/helpers/lastCtx.ts`**

```ts
import type { Api } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import type { BotContext } from "../telegram/botContext.ts";

let lastApi: { api: Api; me: UserFromGetMe } | undefined;
let lastCtx: BotContext | undefined;

export function setLastCtx(ctx: BotContext) {
  lastCtx = ctx;
  if (ctx?.api && ctx?.me) lastApi = { api: ctx.api, me: ctx.me };
}

export function getLastApi() {
  return lastApi;
}

/** @deprecated transitional — removed in the HTTP-handler task once index.ts stops spreading contexts. */
export function useLastCtx() {
  return lastCtx;
}
```

- [ ] **Step 3: Update `tests/telegram/context.test.ts`**

The `createNewContext` cases (lines ~133-141) currently pass a plain-object ctx; the new implementation calls `new Context(update, api, me)`, so the fake needs `update`, `api`, `me`:

```ts
const ctx = {
  update: { update_id: 1, message: oldMsg },
  api: {},
  me: { username: "test_bot" },
  secondTry: true,
} as unknown as BotContext;
const newCtx = createNewContext(ctx, newMsg);
expect(newCtx.message).toBe(newMsg);          // getter over the substituted update
expect(newCtx.update.message).toBe(newMsg);
expect((newCtx as { secondTry?: boolean }).secondTry).toBe(true);  // flavor re-attached
```

`getCtxChatMsg`/`getChatConfig` cases: replace any `botInfo: { username: ... }` fake key with `me: { username: ... }`.

- [ ] **Step 4: Run**

`npm test -- tests/telegram/context.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/context.ts src/helpers/lastCtx.ts tests/telegram/context.test.ts
git commit -m "refactor(grammy): synthetic contexts via public Context constructor + flavor attach

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 2 — Rich outbound pipeline (deliberately NOT parity; spec-approved)

### Task 10: Rewrite streaming to rich drafts only

**Files:**
- Modify: `src/helpers/gpt/streaming.ts` (full rewrite)
- Test: `tests/helpers/streaming.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `useBot` (Task 8).
- Produces (LOCKED): `createRichDraftFlusher(bot, msg): { add(delta: string): void; finish(): Promise<{ fullText: string }> }`, `__testStreaming.reset()`, `handleStream<T,R>(stream, msg, chatConfig, callbacks): Promise<R>` where `callbacks.finalize(fullText, toolCalls)` — NO `sentMessages`, NO edit/delete helpers. `handleResponseStream`/`handleCompletionStream` keep names; their returns lose `sentMessages`.
- DELETED (verify no importers first: `grep -rn "createFlusher\|createDraftFlusher\|safeSend\|safeEdit\|safeDelete\|safeSendDraft\|getRetryAfter\|sentMessages" src/ tests/`): `createFlusher`, `createDraftFlusher`, `safeSend`, `safeEdit`, `safeDelete`, `safeSendDraft`, the `getRetryAfter` bridge from Task 4, and — if unused elsewhere — `delay`.

- [ ] **Step 1: Rewrite `src/helpers/gpt/streaming.ts`**

Keep: the OpenAI imports, `convertResponsesOutput`, the tool-call accumulation logic, the `responseButtons` early-return branches in `handleResponseStream`/`handleCompletionStream` (they never streamed to Telegram — copy them forward unchanged, minus `sentMessages: []` in returns). Delete: everything listed above, plus the now-unused `telegramifyMarkdown` and `splitBigMessage` imports (final rendering moved wholly into send.ts). New core:

```ts
import type { ConfigChatType } from "../../types.ts";
import { Message } from "grammy/types";
import { useBot } from "../../bot.ts";

let nextDraftId = 1;
export const __testStreaming = {
  reset() {
    nextDraftId = 1;
  },
};

export function createRichDraftFlusher(bot: ReturnType<typeof useBot>, msg: Message.TextMessage) {
  const draftId = nextDraftId++;
  const messageThreadId = (msg as { message_thread_id?: number }).message_thread_id;
  const threadOpts = messageThreadId !== undefined ? { message_thread_id: messageThreadId } : undefined;
  let fullText = "";
  let flushTimeout: NodeJS.Timeout | undefined;
  let processing = true;
  // In-flight flush guard: finish() must await it so a late flush can't repaint
  // the draft after the clear below (same invariant as the old draft flusher).
  let activeFlush: Promise<void> | undefined;

  async function flush() {
    try {
      // 429s are retried by the auto-retry transformer installed in useBot().
      await bot.api.sendRichMessageDraft(msg.chat.id, draftId, { markdown: fullText }, threadOpts);
    } catch (err) {
      console.warn("sendRichMessageDraft failed", err);
    }
  }

  function scheduleFlush() {
    if (flushTimeout) return;
    flushTimeout = setTimeout(async () => {
      flushTimeout = undefined;
      activeFlush = flush();
      try {
        await activeFlush;
      } finally {
        activeFlush = undefined;
      }
      if (processing) scheduleFlush();
    }, 2000);
  }

  function add(delta: string) {
    fullText += delta;
    scheduleFlush();
  }

  async function finish() {
    processing = false;
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = undefined;
    }
    if (activeFlush) await activeFlush;
    try {
      // Clear the ephemeral draft (empty text allowed since Bot API 10.1); the
      // persisted answer is sent by the normal rich send path. Smoke item 5
      // verifies an empty plain draft clears a rich draft.
      await bot.api.sendMessageDraft(msg.chat.id, draftId, "", threadOpts);
    } catch (err) {
      console.warn("sendMessageDraft clear failed", err);
    }
    return { fullText } as const;
  }

  return { add, finish } as const;
}
```

`handleStream` keeps its chunk loop and tool-call accumulator verbatim, but: flusher is always `createRichDraftFlusher(bot, msg)` (no `streamMode` read — the config field dies in Task 13); after the loop `const { fullText } = await flusher.finish();` and `return await callbacks.finalize(fullText, Object.values(finalToolCalls));`. In `handleResponseStream.finalize` / `handleCompletionStream.finalize`: drop the chunk-edit/delete loops and `helpers` param entirely — they reduce to the existing final-result assembly (`convertResponsesOutput(completed)` / `finalChatCompletion()` ladder, tool_calls back-fill) and `return { res, ... }` without `sentMessages`.

- [ ] **Step 2: Rewrite `tests/helpers/streaming.test.ts`**

```ts
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import type { Message } from "grammy/types";

const sendRichMessageDraft = jest.fn(async () => true);
const sendMessageDraft = jest.fn(async () => true);
const fakeBot = { api: { sendRichMessageDraft, sendMessageDraft } } as never;

jest.unstable_mockModule("../../src/bot.ts", () => ({
  useBot: jest.fn(() => fakeBot),
  botReady: jest.fn(async () => {}),
  getBots: jest.fn(() => ({})),
  setRunnerHandle: jest.fn(),
  getRunnerHandles: jest.fn(() => ({})),
}));

const { createRichDraftFlusher, handleStream, __testStreaming } = await import(
  "../../src/helpers/gpt/streaming.ts"
);

const msg = { chat: { id: 5 }, message_id: 1 } as Message.TextMessage;

describe("createRichDraftFlusher", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    sendRichMessageDraft.mockClear();
    sendMessageDraft.mockClear();
    __testStreaming.reset();
  });
  afterEach(() => jest.useRealTimers());

  it("flushes accumulated markdown as one rich draft per 2s tick", async () => {
    const f = createRichDraftFlusher(fakeBot, msg);
    f.add("Hello ");
    f.add("**world**");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendRichMessageDraft).toHaveBeenCalledWith(5, 1, { markdown: "Hello **world**" }, undefined);
  });

  it("reuses the same draft_id across flushes and increments per flusher", async () => {
    const f1 = createRichDraftFlusher(fakeBot, msg);
    f1.add("a");
    await jest.advanceTimersByTimeAsync(2000);
    f1.add("b");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft.mock.calls.map((c) => c[1])).toEqual([1, 1]);
    const f2 = createRichDraftFlusher(fakeBot, msg);
    f2.add("c");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft.mock.calls[2][1]).toBe(2);
  });

  it("passes message_thread_id when present", async () => {
    const threadMsg = { chat: { id: 5 }, message_thread_id: 77 } as never;
    const f = createRichDraftFlusher(fakeBot, threadMsg);
    f.add("x");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft).toHaveBeenCalledWith(5, 1, { markdown: "x" }, { message_thread_id: 77 });
  });

  it("finish() awaits in-flight flush, then clears via empty plain draft", async () => {
    let release!: () => void;
    sendRichMessageDraft.mockImplementationOnce(
      () => new Promise<true>((r) => (release = () => r(true))),
    );
    const f = createRichDraftFlusher(fakeBot, msg);
    f.add("slow");
    await jest.advanceTimersByTimeAsync(2000); // flush now in flight
    const finishP = f.finish();
    let finished = false;
    void finishP.then(() => (finished = true));
    await Promise.resolve();
    expect(finished).toBe(false); // blocked on in-flight flush
    release();
    const { fullText } = await finishP;
    expect(fullText).toBe("slow");
    expect(sendMessageDraft).toHaveBeenCalledWith(5, 1, "", undefined);
  });

  it("swallows draft errors and keeps streaming", async () => {
    sendRichMessageDraft.mockRejectedValueOnce(new Error("boom"));
    const f = createRichDraftFlusher(fakeBot, msg);
    f.add("x");
    await jest.advanceTimersByTimeAsync(2000);
    f.add("y");
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendRichMessageDraft).toHaveBeenCalledTimes(2);
    await f.finish();
  });
});

describe("handleStream", () => {
  beforeEach(() => __testStreaming.reset());

  it("accumulates deltas + tool calls and passes them to finalize", async () => {
    async function* stream() {
      yield { d: "Hel", tc: [{ index: 0, id: "t1", function: { name: "fn", arguments: '{"a"' } }] };
      yield { d: "lo", tc: [{ index: 0, function: { arguments: ":1}" } }] };
    }
    const result = await handleStream(stream(), msg, undefined, {
      extractDelta: (c: { d?: string }) => c.d,
      extractToolCalls: (c: { tc?: never[] }) => c.tc,
      finalize: async (fullText, toolCalls) => ({ fullText, toolCalls }),
    });
    expect(result.fullText).toBe("Hello");
    expect(result.toolCalls).toEqual([
      { index: 0, id: "t1", type: undefined, function: { name: "fn", arguments: '{"a":1}' } },
    ]);
  });
});
```

Port any surviving `handleResponseStream`/`handleCompletionStream` cases from the old file (responseButtons branch, finalChatCompletion ladder) minus every `sentMessages`/`safeEdit`/`safeDelete`/`callApi` assertion.

- [ ] **Step 3: Fix straggler importers**

`grep -rn "safeSend\|safeEdit\|safeDelete\|createFlusher\|createDraftFlusher\|getRetryAfter\|sentMessages" src/ tests/` — expected hits only in `tests/helpers/llm*.test.ts`/`gpt.test.ts` IF they assert on `sentMessages` in returned objects; delete those assertion fragments. `src/helpers/gpt/llm.ts` does not use `sentMessages` (verified).

- [ ] **Step 4: Run**

`npm test -- tests/helpers/streaming.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/helpers/gpt/streaming.ts tests/helpers/streaming.test.ts tests/helpers
git commit -m "feat(streaming): rich message drafts via Bot API 10.1; drop edit-mode streaming

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Rich-first send layer

**Files:**
- Modify: `src/telegram/send.ts`
- Test: `tests/telegram/send.test.ts`, `tests/telegram/sendMessageExtra.test.ts`

**Interfaces:**
- Consumes: `useBot` (Task 8), `isBlockedByUser`/`getErrorDescription` (Task 4 — internals swapped HERE to GrammyError).
- Produces: `sendTelegramMessage(chat_id, text, extraMessageParams?, ctx?, chatConfig?)` — SAME signature; rich-first behavior; the returned object always carries `.text` (synthesized on the rich path) so downstream `.text` readers (HTTP handler) keep working. `editTelegramMessage`, `sendTelegramDocument` ported. Callers may keep passing `reply_to_message_id` — send.ts translates to `reply_parameters`.

- [ ] **Step 1: Swap `src/telegram/errors.ts` internals to grammY (call sites untouched)**

```ts
import { GrammyError } from "grammy";

export function getRetryAfterMs(err: unknown): number | undefined {
  if (err instanceof GrammyError && err.error_code === 429 && err.parameters?.retry_after) {
    return err.parameters.retry_after * 1000;
  }
  return undefined;
}

export function isBlockedByUser(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

export function isInvalidToken(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 401;
}

export function getErrorDescription(err: unknown): string {
  if (err instanceof GrammyError) return err.description;
  if (err instanceof Error) return err.message;
  return String(err);
}
```

Update `tests/telegram/errors.test.ts` fixtures to construct real errors — add a helper at the top and swap the plain-object fixtures for it:

```ts
import { GrammyError } from "grammy";
function makeGrammyError(error_code: number, description = "", parameters: Record<string, unknown> = {}) {
  return new GrammyError(
    `Call to method failed! (${error_code}: ${description})`,
    { ok: false, error_code, description, parameters } as never,
    "sendMessage",
    {},
  );
}
```

- [ ] **Step 2: Port `src/telegram/send.ts`**

Imports: types from `grammy/types` (done in Task 7); `import { Context, InputFile, GrammyError } from "grammy";` replacing the telegraf import; `import { isBlockedByUser, getErrorDescription } from "./errors.ts";` (already partially there from Task 4); drop the local `TelegramError` interface. `ctx` params typed `BotContext` (`ExtraCtx` interface deleted — `noSendTelegram`/`progressCallback` live on `BotFlavor`). Then restructure `sendTelegramMessage` (keeping: the `chat_id` guard, chatConfig resolution — now `ctx?.me.username` — the noSendTelegram short-circuit, `<final_answer>` strip and `<think>` split, deleteAfter/forDelete blocks):

```ts
export async function sendTelegramMessage(
  chat_id: number,
  text: string,
  extraMessageParams?: Record<string, unknown>,
  ctx?: BotContext,
  chatConfig?: ConfigChatType,
): Promise<Message.TextMessage | undefined> {
  // ... existing chat_id guard, chatConfig resolution (ctx?.me.username), noSendTelegram branch ...

  const params: Record<string, unknown> = { ...extraMessageParams };
  const plainText = Boolean(params.plainText);
  if (plainText) delete params.plainText;

  // Bot API 7+ replaced reply_to_message_id; translate so handlers stay unchanged.
  if (params.reply_to_message_id) {
    params.reply_parameters = { message_id: params.reply_to_message_id };
    delete params.reply_to_message_id;
  }

  // ... existing <final_answer> strip + <think> split (recursive call unchanged) ...

  let response: Message.TextMessage | undefined;

  if (!plainText) {
    // Rich path: raw markdown in, native rendering out, no 4096 splitting.
    try {
      const richOther: Record<string, unknown> = {};
      for (const key of [
        "reply_markup",
        "reply_parameters",
        "message_thread_id",
        "business_connection_id",
        "disable_notification",
      ]) {
        if (params[key] !== undefined) richOther[key] = params[key];
      }
      const rich = await useBot(chatConfig.bot_token).api.sendRichMessage(
        chat_id,
        { markdown: text },
        richOther,
      );
      // RichMessageMessage has no .text — synthesize it for downstream readers
      // (HTTP handler answers with sentMsg.text).
      response = { ...rich, text } as unknown as Message.TextMessage;
    } catch (e) {
      if (isBlockedByUser(e)) {
        log({ msg: `User ${chat_id} blocked the bot. Error: ${getErrorDescription(e)}`, chatId: chat_id, logLevel: "warn" });
        return undefined;
      }
      log({
        msg: `sendRichMessage failed, falling back to legacy send: ${getErrorDescription(e)}`,
        chatId: chat_id,
        chatTitle: chatConfig.name,
        logLevel: "warn",
      });
      response = undefined; // fall through to legacy path
    }
  }

  if (!response) {
    // Legacy path: plainText sends and rich-send fallback.
    // ... the EXISTING parse_mode autodetection, sanitizeTelegramHtml/telegramifyWithCodeBlocks,
    // splitBigMessage loop with 500ms delays, per-chunk try/catch — with two edits:
    //   useBot(chatConfig.bot_token).telegram.sendMessage(...) → useBot(chatConfig.bot_token).api.sendMessage(...)
    //   `error?.response?.error_code === 403` branch → `isBlockedByUser(e)` (already from Task 4)
  }

  // ... existing deleteAfter / forDelete / deleteAfterNext blocks, with
  //     .telegram.deleteMessage → .api.deleteMessage ...
  return response;
}
```

`editTelegramMessage`: `.telegram.editMessageText(chat.id, message_id, undefined, processedText, params)` → `.api.editMessageText(message.chat.id, message.message_id, processedText, params)` (inline slot GONE — dropping the `undefined` is mandatory, the old arg order compiles into the wrong slot otherwise); `ctx?.botInfo.username` → `ctx?.me.username`; fallback branch unchanged. `sendTelegramDocument`: `Input.fromBuffer(file, fileName)` → `new InputFile(file, fileName)`; `Input.fromLocalFile(file)` → `new InputFile(file)`; `.telegram.sendDocument` → `.api.sendDocument`; error log via `getErrorDescription`.

- [ ] **Step 3: Update send tests**

`tests/telegram/send.test.ts` + `tests/telegram/sendMessageExtra.test.ts`: fake bots change `telegram:` → `api:` and gain `sendRichMessage: jest.fn(async () => ({ message_id: 10, chat: { id: 1 } }))`. Existing MarkdownV2/split assertions move under a `plainText` or fallback framing. New cases:

```ts
it("sends via sendRichMessage with raw markdown and passthrough options", async () => {
  await sendTelegramMessage(1, "# Title\n\nlong text", { reply_markup: kb, reply_to_message_id: 7 });
  expect(api.sendRichMessage).toHaveBeenCalledWith(
    1,
    { markdown: "# Title\n\nlong text" },
    { reply_markup: kb, reply_parameters: { message_id: 7 } },
  );
  expect(api.sendMessage).not.toHaveBeenCalled();  // no splitting, no legacy call
});

it("returns a message carrying .text on the rich path", async () => {
  const res = await sendTelegramMessage(1, "hello");
  expect(res?.text).toBe("hello");
});

it("falls back to legacy MarkdownV2 send when sendRichMessage rejects", async () => {
  api.sendRichMessage.mockRejectedValueOnce(makeGrammyError(400, "media rights required"));
  await sendTelegramMessage(1, "hi *there*");
  expect(api.sendMessage).toHaveBeenCalled(); // telegramified, split, MarkdownV2
});

it("uses only the legacy path for plainText sends", async () => {
  await sendTelegramMessage(1, "https://x.io/?a=%20b", { plainText: true });
  expect(api.sendRichMessage).not.toHaveBeenCalled();
});

it("returns undefined and stops when blocked by user (403) on rich path", async () => {
  api.sendRichMessage.mockRejectedValueOnce(makeGrammyError(403, "bot was blocked by the user"));
  const res = await sendTelegramMessage(1, "hi");
  expect(res).toBeUndefined();
  expect(api.sendMessage).not.toHaveBeenCalled();
});
```

(Reuse `makeGrammyError` from Step 1's errors test — lift it into a shared `tests/testHelpers.ts` export.)

- [ ] **Step 4: Run**

`npm test -- tests/telegram/send.test.ts tests/telegram/sendMessageExtra.test.ts tests/telegram/errors.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/telegram/send.ts src/telegram/errors.ts tests/telegram tests/testHelpers.ts
git commit -m "feat(send): rich messages as the default outbound path with legacy fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Port vision.ts (getFile) and confirm.ts (grammY renames)

**Files:**
- Modify: `src/helpers/vision.ts`, `src/telegram/confirm.ts`
- Test: `tests/helpers/vision.test.ts`, `tests/telegram/confirm.test.ts`

**Interfaces:**
- Consumes: `withChatAction` (Task 5), `getErrorDescription` (Task 4/11), `createNewContext` (Task 9), `Bot<BotContext>` (Task 8).

- [ ] **Step 1: vision.ts**

`import { Context } from "telegraf"` → `import type { BotContext } from "../telegram/botContext.ts"` (param types `ctx: BotContext`). Replace the `getFileLink` block (lines 27-36):

```ts
let link: string;
try {
  const bot = useBot(chatConfig.bot_token);
  const file = await bot.api.getFile(fileId);
  link = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
} catch (error) {
  const d = getErrorDescription(error);
  if (d.includes("wrong file_id") || d.includes("temporarily unavailable")) {
    throw new Error("Не удалось получить изображение.");
  }
  throw error;
}
```

and `image_url: { url: link.toString() }` → `image_url: { url: link }`. (grammY `Bot` exposes `.token` publicly.)

- [ ] **Step 2: confirm.ts grammY renames**

`import { Telegraf, Context } from "telegraf"` → `import { Bot } from "grammy"; import type { BotContext } from "../telegram/botContext.ts";`. `registerConfirmActions(bot: Bot<BotContext>)`; `bot.action(/.../, h)` → `bot.callbackQuery(/.../, h)`; handler ctx type `BotContext` with `ctx.match` (grammY provides `RegExpMatchArray` — indexing `ctx.match[1]` works, drop the `RegExpExecArray` cast); `ctx.answerCbQuery("Expired")` → `ctx.answerCallbackQuery("Expired")`; `ctx.answerCbQuery()` → `ctx.answerCallbackQuery()`.

- [ ] **Step 3: Tests**

`tests/helpers/vision.test.ts`: the fake `useBot` return changes from `{ telegram: { getFileLink: jest.fn(() => ({ href })) } }` to `{ token: "tok", api: { getFile: jest.fn(async () => ({ file_path: "photos/x.jpg" })) } }`; assert the constructed URL `https://api.telegram.org/file/bottok/photos/x.jpg` reaches the LLM call. `tests/telegram/confirm.test.ts`: fake bot key `action` → `callbackQuery`; ctx fake `answerCbQuery` → `answerCallbackQuery`; `match: ["confirm_1", "confirm", "1"]` stays.

Run: `npm test -- tests/helpers/vision.test.ts tests/telegram/confirm.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/helpers/vision.ts src/telegram/confirm.ts tests/helpers/vision.test.ts tests/telegram/confirm.test.ts
git commit -m "refactor(grammy): port vision file download and confirm callbacks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: Remove `streamMode` from config (rich drafts are the only streaming)

**Files:**
- Modify: `src/types.ts`, `src/config.ts`, `src/commands.ts`, `README.md`
- Test: `grep -rln "streamMode" tests/` (config tests + any handler tests setting it)

- [ ] **Step 1: Remove the field**

- `src/types.ts:155`: delete the `streamMode?: "edit" | "draft";` line (keep `streaming?: boolean;`).
- `src/config.ts:359`: delete `streamMode: "edit",` from the full-example chat (CLAUDE.md config checklist: type + generateConfig sample move together).
- `src/commands.ts:351`: `lines.push(\`Streaming: yes (${chatConfig.chatParams.streamMode ?? "edit"} mode)\`);` → `lines.push("Streaming: yes");`

- [ ] **Step 2: README**

`grep -n "streamMode\|streaming" README.md` — rewrite the streaming chatParams docs: `streaming: true` streams the answer as a Telegram rich-message draft (Bot API 10.1 `sendRichMessageDraft`, updated every 2 s, cleared when the final answer arrives); the `streamMode` option is removed (edit-mode streaming no longer exists — existing configs containing `streamMode` will log a `checkConfigSchema` unknown-field warning, which is intended).

- [ ] **Step 3: Tests + gates**

`grep -rln "streamMode" src/ tests/` → update remaining test fixtures (drop the key or, where a test asserted mode-switching behavior, delete the case — edit mode is gone). Run: `npm test -- tests/config.test.ts tests/configExtras.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/config.ts src/commands.ts README.md tests
git commit -m "feat(config): drop streamMode — streaming always uses rich drafts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
## Phase 3 — Lifecycle and entry point

### Task 14: Port index.ts — filters, catch, runner lifecycle; grammY chatAction

**Files:**
- Modify: `src/index.ts`, `src/telegram/chatAction.ts` (grammY re-implementation)
- Test: `tests/index.start.test.ts`, `tests/index.test.ts`, `tests/telegram/chatAction.test.ts`

**Interfaces:**
- Consumes: `useBot`/`botReady`/`setRunnerHandle` (Task 8), `registerConfirmActions` (Tasks 1/12), `registerCommandActions` (Task 2), `isInvalidToken` (Task 4/11), `BotContext` (Task 7).
- Produces: `launchBot(bot_token, bot_name)` now returns `{ bot: Bot<BotContext>; handle: RunnerHandle } | undefined`; module state `activeBots: { bot; handle; name }[]`. `withChatAction` internals become interval-based (call sites from Task 5 unchanged).

- [ ] **Step 1: Re-implement `src/telegram/chatAction.ts` for grammY**

```ts
import type { BotContext } from "./botContext.ts";

const CHAT_ACTION_INTERVAL_MS = 4000; // Telegram shows an action ~5s; refresh under that

/**
 * Keeps a chat action ("typing", "upload_photo", ...) visible while fn runs.
 * grammY has no persistentChatAction; emulate with sendChatAction on an interval.
 * No-ops for synthetic contexts (noSendTelegram) and contexts without a chat.
 */
export async function withChatAction<T>(
  ctx: unknown,
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const c = ctx as BotContext;
  if (!c?.api || !c?.chat || c.noSendTelegram) return await fn();
  const send = () =>
    c.api
      .sendChatAction(
        c.chat!.id,
        action as Parameters<BotContext["api"]["sendChatAction"]>[1],
        c.businessConnectionId ? { business_connection_id: c.businessConnectionId } : undefined,
      )
      .catch(() => {}); // indicator is best-effort; never break the wrapped work
  await send();
  const timer = setInterval(() => void send(), CHAT_ACTION_INTERVAL_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}
```

Rewrite `tests/telegram/chatAction.test.ts` for the new internals (fake timers):

```ts
it("sends the action immediately and every 4s until fn settles", async () => {
  jest.useFakeTimers();
  const sendChatAction = jest.fn(async () => true);
  const ctx = { api: { sendChatAction }, chat: { id: 9 } };
  let release!: (v: string) => void;
  const p = withChatAction(ctx, "typing", () => new Promise<string>((r) => (release = r)));
  await Promise.resolve();
  expect(sendChatAction).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(8000);
  expect(sendChatAction).toHaveBeenCalledTimes(3);
  release("done");
  await expect(p).resolves.toBe("done");
  await jest.advanceTimersByTimeAsync(8000);
  expect(sendChatAction).toHaveBeenCalledTimes(3); // stopped after fn settled
  expect(sendChatAction).toHaveBeenLastCalledWith(9, "typing", undefined);
});
it("passes business_connection_id when the context carries one", async () => { /* ctx.businessConnectionId = "b1" → third arg { business_connection_id: "b1" } */ });
it("runs fn directly for synthetic contexts (no api / noSendTelegram)", async () => {
  expect(await withChatAction({}, "typing", async () => 1)).toBe(1);
  const sendChatAction = jest.fn();
  await withChatAction({ api: { sendChatAction }, chat: { id: 1 }, noSendTelegram: true }, "typing", async () => 2);
  expect(sendChatAction).not.toHaveBeenCalled();
});
it("propagates fn rejection and still clears the interval", async () => { /* rejects + no further sendChatAction after */ });
```

Write the two sketched cases out fully following the first case's pattern. Run: `npm test -- tests/telegram/chatAction.test.ts` → PASS.

- [ ] **Step 2: Port `src/index.ts` imports and state**

```ts
import { Bot, BotError } from "grammy";
import { run, sequentialize, RunnerHandle } from "@grammyjs/runner";
import type { BotContext } from "./telegram/botContext.ts";
import { useBot, botReady, setRunnerHandle } from "./bot.ts";
import { registerConfirmActions } from "./telegram/confirm.ts";
import { registerCommandActions } from "./commands.ts";  // merge into the existing commands.ts import
import { isInvalidToken } from "./telegram/errors.ts";
```

(delete `telegraf` and `telegraf/filters` imports; `Message` already comes from `grammy/types`). State: `let activeBots: { bot: Bot<BotContext>; handle: RunnerHandle; name: string }[] = [];`

- [ ] **Step 3: Rewrite `launchBot` (replaces src/index.ts:104-218)**

```ts
const ALLOWED_UPDATES = [
  "message",
  "edited_message", // Telegraf's launch derived this implicitly from the filters; explicit now (bot.on edited_message:text depends on it)
  "message_reaction",
  "callback_query",
  "inline_query",
  "chosen_inline_result",
  "business_connection",
  "business_message",
] as const;

async function launchBot(bot_token: string, bot_name: string) {
  try {
    const bot = useBot(bot_token);
    await botReady(bot_token); // 401 invalid token rejects here

    // Per-chat ordering with cross-chat concurrency (Telegraf polled concurrently;
    // plain grammY bot.start() is strictly sequential — runner restores parallelism).
    bot.use(
      sequentialize((ctx) => ctx.chat?.id.toString() ?? (ctx as BotContext).businessConnectionId),
    );

    bot.command("help", async (ctx) => ctx.reply("https://github.com/popstas/telegram-functions-bot"));
    await initCommands(bot);
    registerConfirmActions(bot);
    registerCommandActions(bot);

    bot.on(["message:text", "edited_message:text"], onTextMessage);
    bot.on("message:photo", onPhoto);
    bot.on("message:voice", onAudio);
    bot.on("message:audio", onAudio);
    bot.on("message:sticker", onUnsupported);
    bot.on("message:video", onUnsupported);
    bot.on("message:video_note", onUnsupported);
    bot.on("message:document", onDocument);
    bot.on("message_reaction", onReaction);
    bot.on("inline_query", onInlineQuery);
    bot.on("chosen_inline_result", onChosenInlineResult);
    bot.on("business_connection", onBusinessConnection); // natively typed — casts gone
    bot.on("business_message", onBusinessMessage);

    bot.catch((err: BotError<BotContext>) => {
      log({
        msg: `[${bot_name}] Unhandled error for update ${err.ctx.update.update_id}: ${err.error instanceof Error ? err.error.message : String(err.error)}`,
        logLevel: "error",
      });
      if (err.error instanceof Error) console.error(err.error.stack);
    });

    bot.callbackQuery("add_chat", handleAddChat);
    bot.callbackQuery(/^f:(\d+):(\d+)$/, async (ctx) => {
      const match = ctx.match;
      if (match && match[1] && match[2]) {
        await handleFormButtonClick(ctx, parseInt(match[1], 10), parseInt(match[2], 10));
      }
    });
    bot.callbackQuery(/^fl:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
    });

    const handle = run(bot, {
      runner: { fetch: { allowed_updates: ALLOWED_UPDATES as unknown as string[] } },
    });
    setRunnerHandle(bot_token, handle);
    handle.task()?.catch((error: unknown) => {
      log({
        msg: `[${bot_name}] Runner stopped with error: ${error instanceof Error ? error.message : String(error)}`,
        logLevel: "error",
      });
      scheduleRestart();
    });
    log({ msg: `bot started: ${bot_name}` });
    return { bot, handle, name: bot_name };
  } catch (error: unknown) {
    if (isInvalidToken(error)) {
      log({
        msg: `[${bot_name}] Error: Invalid bot token (401 Unauthorized). Please check your bot token in the config.`,
        logLevel: "error",
      });
    } else {
      log({
        msg: `[${bot_name}] Error during bot launch: ${error instanceof Error ? error.message : String(error)}`,
        logLevel: "error",
      });
      if (error instanceof Error) console.error(error.stack);
    }
  }
}
```

`startBot` adjusts to the new return: `const mainBot = await launchBot(...); if (mainBot) activeBots.push(mainBot);` (same shape for chat bots). `stopAllBots` becomes:

```ts
async function stopAllBots() {
  if (activeBots.length === 0) return;
  const entries = [...activeBots];
  activeBots = [];
  await Promise.all(
    entries.map(async ({ handle, name }) => {
      try {
        await handle.stop();
      } catch (error) {
        log({ msg: `Error stopping bot ${name}: ${error instanceof Error ? error.message : String(error)}`, logLevel: "warn" });
      }
    }),
  );
}
```

The old ready/launchPromise wiring (lines 157-196) is fully replaced — `run()` returns synchronously once polling starts, and startup errors surface from `botReady` or `handle.task()`.

- [ ] **Step 4: Update lifecycle tests**

`tests/index.start.test.ts`: mock `"@grammyjs/runner"` with `{ run: jest.fn(() => ({ task: () => Promise.resolve(), stop: jest.fn(async () => {}), isRunning: () => true })), sequentialize: jest.fn(() => (ctx: unknown, next: () => void) => next()) }` and update the `src/bot.ts` mock to the Task 8 export set (`useBot` returning a fake with `use/command/on/catch/callbackQuery` jest.fns, plus `botReady: jest.fn(async () => {})`, `setRunnerHandle`). Assertions move from `bot.launch`-called to `run`-called; the 401 case rejects `botReady` with `makeGrammyError(401, "Unauthorized")` and asserts the invalid-token log. Adjust `tests/index.test.ts` similarly where it touches `launchBot`/`stopAllBots`.

Run: `npm test -- tests/index.start.test.ts tests/index.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/telegram/chatAction.ts tests/index.start.test.ts tests/index.test.ts tests/telegram/chatAction.test.ts
git commit -m "refactor(grammy): runner-based lifecycle, filter queries, BotError handling

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: HTTP synthetic contexts + healthcheck

**Files:**
- Modify: `src/index.ts` (telegramPostHandler), `src/httpHandlers.ts`, `src/healthcheck.ts`, `src/helpers/lastCtx.ts` (drop transitional export)
- Test: `tests/index.http.test.ts`, `tests/httpHandlersAgent.test.ts`, `tests/toolEndpoint.test.ts`, `tests/healthHandler.test.ts`, `tests/healthcheck.test.ts`

**Interfaces:**
- Consumes: `useBot`/`botReady`/`getRunnerHandles` (Task 8), `attachFlavor` (Task 7), `Context` from grammy.
- Produces: HTTP emulation works from boot (no dependency on a previously received Telegram message — approved improvement). `useLastCtx` is deleted; `getLastApi` remains for MQTT if used (`grep -rn "useLastCtx\|getLastApi" src/` and port any remaining consumer the same way as below).

- [ ] **Step 1: Rebuild `telegramPostHandler`'s context (src/index.ts:325-366)**

```ts
import { Context } from "grammy";
import type { Update } from "grammy/types";
import { attachFlavor } from "./telegram/botContext.ts";

// inside telegramPostHandler, replacing the virtualCtx/lastCtx/newCtx block:
const bot = useBot(chatConfig.bot_token);
await botReady(chatConfig.bot_token);

const from = { id: 0, is_bot: false, first_name: "http", username: useConfig().http.telegram_from_username };
const update = {
  update_id: Date.now(),
  message: {
    text,
    chat: { id: parseInt(chatId), title: chatConfig.name, type: "supergroup" as const },
    from,
    message_id: Date.now(),
    date: Math.floor(Date.now() / 1000),
  },
} as unknown as Update;

const newCtx = attachFlavor({ expressRes: res }, new Context(update, bot.api, bot.botInfo));
```

The `onTextMessage(newCtx, undefined, callback)` call and the callback body stay (rich sends carry a synthesized `.text` — Task 11). Delete the `useLastCtx` import and the `botInfo`/spread fallback logic. Note the behavior change to document in the task commit: the virtual chat now receives real `typing` actions via `withChatAction` (the old stub only logged) — acceptable per spec's "HTTP works from boot" improvement; if a test asserts the stub log line, delete that assertion.

- [ ] **Step 2: `src/httpHandlers.ts`**

Swap `import { Context } from "telegraf"` → `import type { BotContext } from "./telegram/botContext.ts"`; the duck-typed fake `{ noSendTelegram: true, progressCallback } as unknown as Context` becomes `as unknown as BotContext` (runtime unchanged — send.ts only reads the flavor props). Same swap in `src/agent-runner.ts` if it appears here via grep: `grep -rn 'from "telegraf"' src/httpHandlers.ts src/agent-runner.ts`.

- [ ] **Step 3: `src/healthcheck.ts` — runner-based liveness**

Replace the Telegraf `.polling` internals probe (lines 23-33):

```ts
import { getBots, getRunnerHandles } from "./bot.ts";

export function getHealthStatus() {
  const bots = getBots();
  const handles = getRunnerHandles();
  const errors: string[] = [];

  const mqttConfig = useConfig().mqtt;
  if (mqttConfig && mqttConfig.host && !isMqttConnected()) {
    errors.push("MQTT is not connected");
  }

  Object.entries(bots).forEach(([token, bot]) => {
    const handle = handles[token];
    if (!handle?.isRunning()) {
      errors.push(`Bot ${bot.botInfo?.username ?? token.slice(0, 8)} is not running`);
    }
  });

  const healthy = errors.length === 0;
  return { healthy, errors } as HealthResponse;
}
```

(`bot.botInfo` throws before init — the `?.` doesn't protect against a throwing getter, so wrap: `let name: string | undefined; try { name = bot.botInfo?.username; } catch { /* not inited */ }` and use `name ?? token.slice(0, 8)`.)

- [ ] **Step 4: Delete `useLastCtx`**

`grep -rn "useLastCtx" src/ tests/` — port/delete every remaining reference (mqtt.ts is the likely other consumer; give it the same `new Context(update, bot.api, bot.botInfo)` treatment as Step 1 if it builds virtual messages). Remove the transitional export from `src/helpers/lastCtx.ts`.

- [ ] **Step 5: Tests + run**

Update the five test files: bot fakes expose `api`/`botInfo`, runner handles via mocked `getRunnerHandles`; HTTP tests assert the response body still equals the answer text (rich `.text` synthesis makes this hold); healthcheck tests: running handle → healthy, missing/stopped handle → `Bot ... is not running`. Run: `npm test -- tests/index.http.test.ts tests/httpHandlersAgent.test.ts tests/toolEndpoint.test.ts tests/healthHandler.test.ts tests/healthcheck.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/httpHandlers.ts src/healthcheck.ts src/helpers/lastCtx.ts src/mqtt.ts tests
git commit -m "refactor(grammy): HTTP emulation on real Context from boot; runner-based healthcheck

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 16: Port commands.ts

**Files:**
- Modify: `src/commands.ts`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Consumes: `Bot<BotContext>` (Task 8). `registerCommandActions` (Task 2) gets the same signature swap as confirm did in Task 12.

- [ ] **Step 1: Port**

- `import { Telegraf, Context } from "telegraf"` → `import { Bot } from "grammy"; import type { BotContext } from "./telegram/botContext.ts";` — handler params `ctx: Context` → `ctx: BotContext`; `initCommands(bot: Telegraf)` → `initCommands(bot: Bot<BotContext>)`; `registerCommandActions(bot: Bot<BotContext>)`; inside it `bot.action` → `bot.callbackQuery` and `await ctx.answerCbQuery()` → `await ctx.answerCallbackQuery()`; in `handleAddToolAction`/`handleAddSkillAction` the `answerCbQuery("Unknown ...")` casts → plain `ctx.answerCallbackQuery("Unknown tool")`.
- `bot.start(handleStart)` → `bot.command("start", handleStart)`; in `handleStart` the payload line becomes:

```ts
const rawPayload =
  (typeof (ctx as { match?: unknown }).match === "string" && (ctx as { match?: string }).match) ||
  msg?.text?.split(" ")[1];
```

(grammY sets `ctx.match` to the command's argument string; the old Telegraf-only `ctx.startPayload` read is dropped, the `msg.text` fallback already covered tests.)
- `bot.telegram.setMyCommands([...])` → `bot.api.setMyCommands([...])` (array unchanged).

- [ ] **Step 2: Tests + run**

`tests/commands.test.ts`: fake bot gains `command`/`callbackQuery` jest.fns (drop `start`/`action`/`telegram.setMyCommands` → `api.setMyCommands`); `handleStart` deeplink case drops the `startPayload` property from its ctx literal and passes the payload via `match: "<base64>"` or message text (both paths covered). ctx fakes rename `answerCbQuery` → `answerCallbackQuery`. Run: `npm test -- tests/commands.test.ts` → PASS.

- [ ] **Step 3: Commit**

```bash
git add src/commands.ts tests/commands.test.ts
git commit -m "refactor(grammy): port commands registration and start deeplink payload

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
## Phase 4 — Handlers and helper sweep

### Task 17: Port onTextMessage, resolveChatButtons, formFlow

**Files:**
- Modify: `src/handlers/onTextMessage.ts`, `src/handlers/resolveChatButtons.ts`, `src/handlers/formFlow.ts`, `src/handlers/access.ts`
- Test: `tests/handlers/onTextMessage*.test.ts` (5 files), `tests/handlers/guestMode.test.ts`, `tests/handlers/isMentioned.test.ts`, `tests/helpers/resolveChatButtons.test.ts`, `tests/helpers/handlersMention.test.ts`, formFlow tests

**Interfaces:**
- Consumes: `BotContext` (Task 7), `withChatAction` (Tasks 5/14), raw-literal keyboards (Task 3), send.ts `reply_to_message_id` translation (Task 11 — handler code building `reply_to_message_id` params for `sendTelegramMessage` stays AS IS).

- [ ] **Step 1: onTextMessage.ts + access.ts + resolveChatButtons.ts**

Per file: `import { Context } from "telegraf"` → `import type { BotContext } from "../telegram/botContext.ts"`; every `Context & { secondTry?: boolean }` / `Context & ExtraCtx` intersection → plain `BotContext`; the `(ctx as { businessConnectionId?: string }).businessConnectionId` cast in `launchAnswer` (onTextMessage.ts:168) → `ctx.businessConnectionId`. `ctx.message?.message_id` reads work unchanged (grammY getter). Sites passing `reply_to_message_id` into send params (onTextMessage.ts:170, :283; resolveChatButtons.ts:32; formFlow's `extraParams`) are NOT changed — send.ts translates. Verify nothing calls Telegram directly with those params: `grep -n "reply_to_message_id" src/handlers/*.ts` hits must all flow into `sendTelegramMessage`.

- [ ] **Step 2: formFlow.ts specifics**

- `import { Context } from "telegraf"` → `BotContext` as above (line 1; `Markup` already gone via Task 3).
- Callback-message narrowing (lines 157-162): grammY's `ctx.callbackQuery.message` is `MaybeInaccessibleMessage | undefined` (no `"message" in` narrowing needed; inaccessible ⇔ `date === 0`):

```ts
const callbackQuery = ctx.callbackQuery;
const cbMessage = callbackQuery?.message;
if (!callbackQuery || !cbMessage || cbMessage.date === 0) {
  return;
}
const chatId = cbMessage.chat.id;
```

Replace subsequent `callbackQuery.message?.` reads (`:213` chat title, `:232` message_id) with `cbMessage.`.
- `ctx.answerCbQuery(...)` → `ctx.answerCallbackQuery(...)` — all 6 sites (:172, :182, :190, :197, :203, :223).
- `ctx.editMessageText(statusMessage, buttons)` / `(statusMessage)` (:248-250) — same method name in grammY; `buttons` is already a `{ reply_markup }` object (Task 3) which is a valid grammY `other` — unchanged.

- [ ] **Step 3: Tests**

These test files build plain-object ctx literals double-cast through `Context` — the phantom/real type swap happened in Task 7, so most pass untouched. Runtime fixes needed: ctx fakes providing `answerCbQuery` for formFlow flows rename to `answerCallbackQuery`; any fake `callbackQuery.message` gains `date: 1` (nonzero) so the inaccessible-check passes; fakes with `botInfo` used by these handlers rename to `me`. Run:

```bash
npm test -- tests/handlers/onTextMessageAnswer.test.ts tests/handlers/onTextMessageCancel.test.ts tests/handlers/onTextMessageMemory.test.ts tests/handlers/onTextMessageOuter.test.ts tests/handlers/onTextMessageSecretary.test.ts tests/handlers/guestMode.test.ts tests/handlers/isMentioned.test.ts tests/helpers/resolveChatButtons.test.ts tests/helpers/handlersMention.test.ts
```
→ PASS.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/onTextMessage.ts src/handlers/resolveChatButtons.ts src/handlers/formFlow.ts src/handlers/access.ts tests
git commit -m "refactor(grammy): port text/form/button handlers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 18: Port onAudio, onPhoto, onDocument, onUnsupported

**Files:**
- Modify: `src/handlers/onAudio.ts`, `src/handlers/onPhoto.ts`, `src/handlers/onDocument.ts`, `src/handlers/onUnsupported.ts`
- Test: `tests/handlers/onAudioMain.test.ts`, `tests/handlers/onAudioProcess.test.ts`, `tests/handlers/onPhotoMain.test.ts`, `tests/handlers/onDocumentMain.test.ts`, `tests/handlers/onUnsupported.test.ts`, `tests/handlers/photoAudioEarly.test.ts`

**Interfaces:**
- Consumes: `createNewContext` (Task 9), `withChatAction` (Tasks 5/14). grammY `Api` exposes `.token` publicly (verified) — file URLs need it.

- [ ] **Step 1: onAudio.ts**

- Context import/type swap as in Task 17 (`ctx: BotContext`, drop `& { secondTry?: boolean }`).
- File download (processAudio, lines 40-46):

```ts
const file = await ctx.api.getFile(voice.file_id);
const fileUrl = `https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`;
// ...
const response = await fetch(fileUrl);
```

- Replace the inline `Object.create` clone (lines 88-97) with the Task 9 keystone:

```ts
const fakeMsg = { ...ctx.message, text } as Message;
const newCtx = createNewContext(ctx, fakeMsg);
await onTextMessage(newCtx);
```

(`createNewContext` re-attaches `secondTry` via `attachFlavor` — behavior preserved.)

- [ ] **Step 2: onPhoto.ts, onDocument.ts, onUnsupported.ts**

Context import/type swaps only (all three already dispatch through `createNewContext`/plain sends; `Update`-namespace casts were centralized in Task 6). Verify per file: `grep -n "telegraf" src/handlers/onPhoto.ts src/handlers/onDocument.ts src/handlers/onUnsupported.ts` → 0 after the edit.

- [ ] **Step 3: Tests**

`onAudioMain`/`onAudioProcess`/`photoAudioEarly`: ctx fakes replace `telegram: { getFileLink: () => ({ href }) }` with `api: { getFile: jest.fn(async () => ({ file_path: "voice/f.oga" })), token: "tok" }`... note `token` sits on `ctx.api` directly (`api.token`), and global `fetch` mock expectations change from the old `href` to `https://api.telegram.org/file/bottok/voice/f.oga`. `persistentChatAction` fakes were already routed through `withChatAction` (Task 5) — with the grammY internals, fakes WITHOUT `api` now no-op cleanly; fakes that asserted the action string move to asserting `api.sendChatAction` calls (e.g. the onAudioMain typing assertion becomes `expect(api.sendChatAction).toHaveBeenCalledWith(chatId, "typing", undefined)`). Run:

```bash
npm test -- tests/handlers/onAudioMain.test.ts tests/handlers/onAudioProcess.test.ts tests/handlers/onPhotoMain.test.ts tests/handlers/onDocumentMain.test.ts tests/handlers/onUnsupported.test.ts tests/handlers/photoAudioEarly.test.ts
```
→ PASS.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/onAudio.ts src/handlers/onPhoto.ts src/handlers/onDocument.ts src/handlers/onUnsupported.ts tests/handlers
git commit -m "refactor(grammy): port media handlers; getFile-based downloads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 19: Port onBusinessMessage, onReaction, onInlineQuery

**Files:**
- Modify: `src/handlers/onBusinessMessage.ts`, `src/handlers/onReaction.ts`, `src/handlers/onInlineQuery.ts`
- Test: `tests/handlers/onBusinessMessage.test.ts`, `tests/handlers/onReaction.test.ts`, `tests/handlers/onInlineQuery.test.ts`

**Interfaces:**
- Consumes: `BotContext`, `createNewContext`, `MessageReactionUpdate`/`ChosenInlineResultUpdate` aliases (Task 6/7).

- [ ] **Step 1: onBusinessMessage.ts**

- Context/type swaps as before; `ctx.businessMessage`/`ctx.businessConnection` are natively typed in grammY — remove the raw `ctx.update` casts where the native getters suffice (`grep -n "ctx.update" src/handlers/onBusinessMessage.ts` and replace `(ctx.update as ...).business_message` with `ctx.businessMessage`, same for `business_connection`).
- Raw API shims → typed calls: `callApi("getBusinessConnection", ...)` → `await ctx.api.getBusinessConnection(businessConnectionId)`; `callApi("readBusinessMessage", ...)` → `await ctx.api.readBusinessMessage(businessConnectionId, chatId, messageId)` — delete the local shim types that modeled these responses (grep the file for `callApi`).
- The `persistentChatAction` stub was deleted in Task 5; the flavored `businessConnectionId`/`businessOwnerUsername` props now type-check via `BotContext` (drop their local intersection casts).

- [ ] **Step 2: onReaction.ts + onInlineQuery.ts**

- onReaction.ts: type swaps; reaction payload via `ctx.messageReaction` where the code cast `ctx.update`; the re-dispatch path already uses `createNewContext`.
- onInlineQuery.ts: type swaps; `ctx.inlineQuery`/`ctx.answerInlineQuery(results, { cache_time })` unchanged. Inline-message edits (both sites, :239 and :248 incl. the catch path):

```ts
// was: ctx.telegram.editMessageText(undefined, undefined, inlineMessageId, text, extra)
await ctx.api.editMessageTextInline(inlineMessageId, text, extra);
```

- [ ] **Step 3: Tests**

`onInlineQuery.test.ts`: the 6+ four-positional `editMessageText(undefined, undefined, id, text)` assertions become `editMessageTextInline(id, text, extra)` on an `api` fake key. `onBusinessMessage.test.ts`: `telegram:`→`api:` fakes; `callApi` fakes become `getBusinessConnection`/`readBusinessMessage` jest.fns with the same resolved payloads; update `toHaveBeenCalledWith` accordingly. `onReaction.test.ts`: update literals only if a `botInfo` key is read (→ `me`). Run:

```bash
npm test -- tests/handlers/onBusinessMessage.test.ts tests/handlers/onReaction.test.ts tests/handlers/onInlineQuery.test.ts
```
→ PASS.

- [ ] **Step 4: Commit**

```bash
git add src/handlers/onBusinessMessage.ts src/handlers/onReaction.ts src/handlers/onInlineQuery.ts tests/handlers
git commit -m "refactor(grammy): port business, reaction, inline-query handlers to typed APIs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 20: Helper/tool sweep + zero-telegraf gate

**Files:**
- Modify: `src/agent-runner.ts`, `src/helpers/gpt/llm.ts`, `src/helpers/gpt/tools.ts`, `src/helpers/gpt/toolConfirmation.ts`, `src/helpers/history.ts`, `src/helpers/memory.ts`, `src/helpers/useLangfuse.ts`, `src/helpers/google.ts`, `src/tools/brainstorm.ts`, `src/tools/memory_add.ts`, `src/tools/memory_delete.ts`, `src/tools/memory_search.ts`, `src/types.ts`
- Test: `tests/helpers/gpt.test.ts`, `tests/helpers/gptTools.test.ts`, `tests/helpers/llm*.test.ts`, `tests/helpers/useLangfuse.test.ts`, `tests/googleHelpers.test.ts`, `tests/tools/brainstorm.test.ts`, `tests/agent-runner.test.ts`

- [ ] **Step 1: Sweep the remaining `from "telegraf"` imports**

```bash
grep -rn 'from "telegraf' src/
```

For every remaining hit: `import { Context } from "telegraf"` → `import type { BotContext } from "<rel>/telegram/botContext.ts"` with param-type renames (`Context` → `BotContext`, intersections with `secondTry`/`noSendTelegram`/`progressCallback` collapse to plain `BotContext`). Type-only `Message` imports were already swapped in Task 7. Re-run the grep → **0 matches** (hard gate).

- [ ] **Step 2: botInfo audit**

```bash
grep -rn "botInfo" src/
```

Every remaining read must be either `bot.botInfo` AFTER `botReady()` (bot.ts/index.ts/healthcheck — done in Tasks 8/14/15) or a `ctx.me` rename you make now. Multi-bot routing reads (`send.ts` chatConfig resolution — done in Task 11; `context.ts:57` — done in Task 9) must show up as `ctx.me` in this grep's output. 0 unexplained hits.

- [ ] **Step 3: Fake-bot key sweep in remaining tests**

```bash
grep -rln "telegram: {" tests/ ; grep -rn "answerCbQuery\|getFileLink\|\.launch(" tests/
```

Any file still faking `useBot() => ({ telegram: {...} })` renames the key to `api:` with method fakes matching the grammY names used by its subject module; leftover `answerCbQuery`/`getFileLink`/`launch` fakes belong to earlier tasks — fix stragglers now. Run the affected files:

```bash
npm test -- tests/helpers/gpt.test.ts tests/helpers/gptTools.test.ts tests/helpers/llm.test.ts tests/helpers/llm.extras.test.ts tests/helpers/llm.workflow.test.ts tests/helpers/useLangfuse.test.ts tests/googleHelpers.test.ts tests/tools/brainstorm.test.ts tests/agent-runner.test.ts
```
→ PASS.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "refactor(grammy): sweep remaining helper/tool imports; zero telegraf references in src

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Phase 5/6 — Gates, docs, smoke

### Task 21: Full-green gate — remove telegraf, whole-suite pass

**Files:**
- Modify: `package.json` (+lockfile), any straggler test/src files the gates surface

- [ ] **Step 1: Remove telegraf**

```bash
npm uninstall telegraf
grep -rn "telegraf" src/ tests/ package.json   # expect 0 code hits (README/docs mentions handled in Task 22)
```

- [ ] **Step 2: Whole-suite gates, iterate to green**

```bash
npm run test-full
```

Expect stragglers in these categories (fix, re-run until green): (a) `jest.unstable_mockModule("../src/bot.ts")` sites missing the Task 8 export set — every mock of bot.ts must now provide `useBot`, `botReady`, `getBots`, `setRunnerHandle`, `getRunnerHandles` (CLAUDE.md rule: new exports must appear in ALL mock sites — `grep -rln 'unstable_mockModule("../src/bot' tests/ | xargs grep -Ln botReady` finds offenders); (b) `send.ts` mock sites missing unchanged-name exports (`sendTelegramMessage`, `isAdminUser`, `getFullName`, `sendTelegramDocument`, `editTelegramMessage`, `buildButtonRows`, `getTelegramForwardedUser`, `isOurUser`); (c) typecheck errors from the Bot API 10.x type jump in files that compiled against older shapes (`ChatFullInfo` splits, optional `callbackQuery.message`) — fix with the Task 6 aliases or local narrowing, never with `any`; (d) lint on deleted imports.

- [ ] **Step 3: Format + commit**

```bash
npm run format
git add -A
git commit -m "refactor(grammy): drop telegraf dependency; full suite green

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## E2E test environment (user-provided, 2026-07-05)

Live-bot testing during and after the port uses REAL infrastructure the user granted:

- **Bot:** `popstas_functions_bot` — token already in `config.yml` (`auth.bot_token`). It is a TEST-ONLY bot and its external instance is stopped — no polling-conflict coordination needed; just never run two local `npm start` at once. Bot profile: secretary mode disabled, **inline mode enabled** (inline-query e2e is possible). Some MCP servers in `config.yml` are known-broken — MCP connect errors in startup logs are pre-existing, NOT port regressions (verify by comparing against a pre-port `master` run if unsure).
- **Test group:** `-4897751120`, configured by `data/chats/gpt_responses_api.yml` — already has `streaming: true`, `confirmation: true`, `useResponsesApi: true`, and tools (`javascript_interpreter`, `web_search_preview`, …), which covers rich sends, rich-draft streaming, tool calls, and the confirmation flow in one chat.
- **Permission:** BACKUP FIRST (`cp config.yml config.yml.e2e-backup && cp data/chats/gpt_responses_api.yml data/chats/gpt_responses_api.yml.e2e-backup`), then the user allows changing EVERYTHING in `config.yml` and the chat config for e2e (toggle `streaming`/`confirmation`, remove broken MCP servers, add `prefix`, change model, …). This permission is for LIVE runs only — the CLAUDE.md rule "never change or delete files in `data/` in tests" still applies to Jest tests. Restore from the backups when e2e is done and delete the backup files.
- **Real user account (inbound polling path + readback):** the user's account is scriptable via the telegram-assistant project:

```bash
cd /home/popstas/projects/python/telegram-assistant
./.venv/bin/telegram-assistant messages send --text "test message" --entity @popstas_functions_bot   # or --entity -4897751120
./.venv/bin/telegram-assistant messages recent --entity -4897751120       # read back bot answers (verify rich message arrived)
./.venv/bin/telegram-assistant messages react ...                          # trigger the reaction handler (message_reaction e2e)
./.venv/bin/telegram-assistant messages delete ...                         # clean up own test messages
```

  (Run `--help` on each subcommand for exact flags before first use.) This makes the TRUE inbound path testable end-to-end without the user: send via `messages send` → bot polls the update → handler → answer lands in chat → verify via `messages recent`. Reactions likewise. Prefer this over the HTTP endpoint for anything testing the update-ingestion side; keep HTTP for pipeline-only checks.
- **Driving the pipeline programmatically:** the HTTP emulation endpoint exercises the full LLM→tools→rich-send path with real Telegram sends into the group:

```bash
# port + http_token: config.yml `http:` section (lines ~34-36)
curl -s -X POST "http://localhost:<http.port>/telegram/-4897751120" \
  -H "Authorization: Bearer <http.http_token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Ответь заголовком, таблицей 2x2 и блоком кода — тест rich messages"}'
```

The HTTP body returns the final answer text (rich path synthesizes `.text` — Task 11); the message itself lands in the group. Watch stdout logs for `sendRichMessage`/draft warnings.
- **What only a human can verify** (everything else above is automatable): draft preview appearing/updating/clearing in the chat UI, rich rendering QUALITY (correct API calls are verifiable via logs + `messages recent`; how it LOOKS is not), clicking inline buttons (confirm/cancel, `add_tool`, form `f:`/`fl:`), sending voice/photo/document, typing an inline query, business-account flows.
- **Manual-check policy (user-requested):** GROUP and DEFER all human checks to the latest possible point — do not interrupt the user per item. Run every automatable check first; collect the human items into ONE batched session at Task 23 (plus at most one batch mid-port only if something automatable is blocked on it). Summon the user via the AskUserQuestion tool with a compact numbered list of "click/look/send this, tell me what you see" items.

**E2E checkpoints during execution:**
1. **After Task 16** (first bootable grammY state): `npm start` → expect `bot started: <name>` in logs (ignore pre-existing MCP connect errors), then `telegram-assistant messages send --text "ping" --entity -4897751120` → answer appears (verify via `messages recent`); also run the curl above → HTTP 200 with answer text. This catches lifecycle/context wiring bugs 5 tasks before the full gate. Fully automated — no user needed.
2. **After Task 21** (full green): repeat checkpoint 1; add a >4096-char-answer prompt (expect ONE rich message via `messages recent`), a streaming prompt (logs show `sendRichMessageDraft` without errors), and a `messages react` on a bot answer (reaction handler fires). Fully automated.
3. **Task 23**: run all automatable items below first, then ONE batched AskUserQuestion session for the human items (no separate dev config needed — the Task 23 setup paragraph is superseded by this section).

---

### Task 22: Documentation

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `AGENTS.md`

- [ ] **Step 1: README**

`grep -n "telegraf\|Telegraf\|streaming\|streamMode" README.md` — update: framework references (Telegraf → grammY), the streaming section (rich drafts, already partly done in Task 13), any bot-setup docs mentioning Telegraf options (proxy_url still supported — new mechanism is internal). Document the new outbound behavior: answers are sent as Telegram rich messages (native markdown rendering: headings, code blocks, tables; no 4096-char splitting); `plainText` sends and rich-send failures use the legacy MarkdownV2 path.

- [ ] **Step 2: CLAUDE.md + AGENTS.md**

In the "Key file relationships (skills, reply context, streaming)" section, rewrite the streaming bullet: `src/helpers/gpt/streaming.ts` — `createRichDraftFlusher()` streams the answer as a Bot API 10.1 rich-message draft (`sendRichMessageDraft`, 2 s cadence, cleared on finish); gate is `chatParams.streaming` (streamMode is gone); `handleStream()` accumulates deltas/tool calls and finalizes via the rich send path. Add to "Key file relationships (MCP and tools)" or a new bullet: `src/telegram/botContext.ts` (BotContext flavor), `src/telegram/errors.ts`, `src/telegram/chatAction.ts`, `src/telegram/updateTypes.ts`, and the bot.ts contract (`useBot`/`botReady`/runner handles). Mirror every CLAUDE.md edit into AGENTS.md (they share content — `diff CLAUDE.md AGENTS.md` should show the same relationship as before your edit).

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md AGENTS.md
git commit -m "docs: grammY port — rich message streaming, new telegram helper modules

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 23: Dev-bot manual smoke pass (before merge)

**Files:** none (manual verification; record results in the PR description)

Setup: use the **E2E test environment** section above — bot `popstas_functions_bot`, group `-4897751120` (`data/chats/gpt_responses_api.yml`), existing `config.yml` (backup both first), `npm start`, watch for `bot started: <name>`.

Execution order (per the manual-check policy): run the AUTO items first via telegram-assistant + HTTP + logs, then batch the HUMAN items into one AskUserQuestion session. Classification: AUTO — 1 (proxy, if configured), 2 (multi-bot, if a second bot_token chat exists), 3 (concurrency: `messages send` to the group + simultaneous HTTP post to another configured chat), 4 (message arrival/oneness via `messages recent`; rendering quality → HUMAN), 6 (flood), 7 (fallback via logs), 8-reaction (`messages react`), 12 (HTTP + lifecycle). HUMAN (batched) — 4-rendering-quality, 5 (draft preview look; API side is AUTO via logs), 8-voice/photo/document, 9 (business, optional — secretary mode is off on this bot), 10 (inline query typing), 11 (button clicks: confirmation Yes/No, `/add_tool`, form buttons).

- [ ] 1. **Proxy startup** (only if `auth.proxy_url` is used in prod): set it in the dev config → bot starts and answers. Failure: startup hang or `HttpError` — the `baseFetchConfig.agent` mapping is wrong (Risk 12 in the spec).
- [ ] 2. **Multi-bot routing**: with a second bot configured, message each bot → each answers as itself (check the answering bot's username). Failure: wrong bot answers or `chatConfig {}` behavior — a missed `ctx.me`/`botInfo` read.
- [ ] 3. **Concurrency (runner check)**: from two different chats, send prompts that take >5 s within the same second → both answers arrive interleaved, neither waits for the other to finish. Failure: strictly serialized answers — runner/sequentialize misconfigured.
- [ ] 4. **Rich sends**: ask for an answer containing a heading, code block, and table → renders natively; ask a >4096-char answer → arrives as ONE message; form/confirmation buttons appear on rich messages; a `deleteAfter` flow (tool message) still deletes.
- [ ] 5. **Rich-draft streaming**: enable `streaming: true` for the test chat → during generation a draft preview appears and updates roughly every 2 s under one draft (not stacking new previews — verifies draft_id update-in-place), disappears when the final answer lands (verifies the empty-plain-draft clear works for rich drafts). Long tool pause >30 s → draft may vanish then reappear on next flush (expected).
- [ ] 6. **Flood/429**: trigger a long streamed answer in a busy group (or artificially lower auto-retry's `maxRetryAttempts` and hammer) → no crash, drafts continue after backoff (auto-retry working).
- [ ] 7. **Fallback path**: send an answer containing an image URL in a chat where the bot lacks media rights (or otherwise force `sendRichMessage` rejection) → message still arrives via legacy MarkdownV2; log shows `sendRichMessage failed, falling back`.
- [ ] 8. **Re-dispatch paths**: voice note → transcription + answer; photo with caption → OCR/vision answer; document → extracted answer; reaction (if `answerReactions`) → reaction-triggered answer; each exercises `createNewContext`.
- [ ] 9. **Business chat** (if used in prod): connect the dev bot to a Business account → incoming customer message gets an answer (single consolidated message — streaming off), typing indicator shows (new: real indicator via `business_connection_id`), message marked read.
- [ ] 10. **Inline queries**: `@devbot query` in any chat → results appear; choose one → inline message edits to the final answer (exercises `editMessageTextInline`, incl. the error-recovery path if the first edit 400s).
- [ ] 11. **Forms + admin commands**: run a configured form → intro, buttons (`f:`/`fl:`), field extraction, completion + `send_to` delivery. `/add_tool` and `/add_skill` → buttons work, callback spinner CLEARS (new behavior), tool actually added; trigger two tool confirmations back-to-back → each Yes/No resolves its own action (pending-map check).
- [ ] 12. **HTTP + lifecycle**: `curl -X POST -H "Authorization: Bearer <http_token>" -H "Content-Type: application/json" -d '{"text":"ping"}' http://localhost:<port>/telegram/<chatId>` BEFORE sending any Telegram message since boot → answer returned in the HTTP body (works-from-boot improvement) and posted to the chat. `GET /health` → `{"healthy":true}`. Ctrl+C → clean shutdown, no unhandled rejections; restart → resumes.

If every box is checked, the port branch is ready for PR (suggested title: `feat: migrate to grammY with rich message streaming (Bot API 10.1)`).

---

## Post-merge follow-ups (explicitly OUT of this plan)

Per the spec: `@grammyjs/conversations` rewrite of formFlow, `@grammyjs/hydrate` adoption, and typechecking `tests/` land as separate follow-up work with their own designs.
