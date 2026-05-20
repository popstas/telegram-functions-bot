# Bot Features: Inline Mode, Secretary Mode, Guest Mode

## Overview

Add three independent bot features driven by configuration, adopted from `data/plan-bot-features.md`:

1. **Inline mode** — let users invoke the bot via `@botname query` from any chat. Configured buttons (with a default "Ask" button) appear as inline results; selecting one runs that button's prompt against the typed query and posts the LLM answer. A live-answer mode is available but disabled by default.
2. **Secretary Mode** — a per-chat debounce: after the first incoming message the bot waits `firstAnswerDelay` seconds, batching rapid follow-ups, then answers once. A `prompt` overrides the system message while in this mode.
3. **Guest Mode** — when the bot is mentioned in a reply to another user's message, both the replied-to message and the user's message are added to thread history (keeping conversation continuity), with `guestMode.prompt` as a system instruction.

## Context

- Library: **telegraf v4.16.3**. Handlers registered in `src/index.ts` (~lines 112–147). No `inline_query` handler exists today — clean slate.
- Config model: global `ConfigType` and per-chat `ConfigChatType` / `ChatParamsType` in `src/types.ts`. Validation is automatic via the `full-example` chat built in `generateConfig()` (`src/config.ts`), checked by `checkConfigSchema()`.
- Reply context today: `buildUserMessage()` / `addToHistory()` in `src/helpers/history.ts` prefix reply metadata only when `chatParams.markReplyToMessage` is set. Replies to *other* users are currently blocked in `isMentioned()` (`src/handlers/access.ts`) unless the bot is tagged/prefixed/replied-to.
- System prompt: `getSystemMessage()` in `src/helpers/gpt/messages.ts` uses `chatConfig.systemMessage` first; `thread.nextSystemMessage` overrides per-turn.
- Existing patterns to mirror: `chatParams` boolean/object toggles (e.g. `streaming`, `deleteToolAnswers`, `markReplyToMessage`); answer flow in `src/handlers/onTextMessage.ts` (`answerToMessage`) → `requestGptAnswer` (`src/helpers/gpt/llm.ts`) → `sendTelegramMessage` (`src/telegram/send.ts`).
- Adopted from free-form source `data/plan-bot-features.md`. Reference: https://core.telegram.org/bots/features

## Development Approach

- Testing approach: regular.
- Complete each task fully before moving to the next.
- Update this plan when scope changes during implementation.
- Config-type checklist (per CLAUDE.md): every new field in `types.ts` needs a sample value in the `full-example` chat / global config in `generateConfig()`, plus README documentation.
- When a source module gains a new import, update all `jest.unstable_mockModule()` sites that mock it (see CLAUDE.md mock-dependency notes).

## Testing Strategy

- Unit tests required for every code-changing Task (Jest + ESM `unstable_mockModule` pattern).
- Run `npm run test-full` (tests + typecheck + lint) after each Task before proceeding.
- Run `npm run format` before finishing.

## Progress Tracking

- Mark completed items with `[x]` immediately when done.
- Update plan if implementation deviates from original scope.

## Technical Details

**Inline mode config (global `ConfigType.inlineMode`):**
```
inlineMode?: {
  buttons?: { name: string; prompt: string }[]; // default includes { name: "Ask", prompt: <chat systemMessage> }
  live_answer?: boolean;   // default false
  debounce_ms?: number;    // debounce for live answer
}
```
Flow: `bot.on("inline_query")` → return `InlineQueryResultArticle[]` built from configured buttons (default "Ask"). Resolve the answer on selection via `bot.on("chosen_inline_result")` (or an `id`-encoded button index) → run the button prompt against `query` through `requestGptAnswer`. When `live_answer` is true, additionally offer a live result computed on the (debounced) query.

**Secretary mode config (`ChatParamsType.secretary`):**
```
secretary?: { firstAnswerDelay: number; prompt?: string } // firstAnswerDelay in seconds
```
Flow: keep a per-chat debounce timer. First message starts the timer; messages arriving within the window are added to history but do not trigger an answer; on timer expiry, answer once. `prompt` is applied as the system message (via `thread.nextSystemMessage` or `getSystemMessage`).

**Guest mode config (global `ConfigType.guestMode`):**
```
guestMode?: { prompt: string }
```
Flow: in `isMentioned()` allow processing when the bot is explicitly mentioned (tag/prefix) in a reply to another user. In `addToHistory()`/`buildUserMessage()`, when guest mode is active for such a reply, add the replied-to message text into thread history alongside the user message; apply `guestMode.prompt` as the system instruction.

## Implementation Steps

### Task 1: Inline mode

- [x] Add `inlineMode?: { buttons?: {name; prompt}[]; live_answer?: boolean; debounce_ms?: number }` to `ConfigType` in `src/types.ts`.
- [x] Create `src/handlers/onInlineQuery.ts`: build `InlineQueryResultArticle[]` from configured buttons, always including a default `Ask` button whose prompt defaults to the chat `systemMessage`; encode the chosen button in the result `id`.
- [x] Add `bot.on("inline_query", onInlineQuery)` and a `chosen_inline_result` handler in `src/index.ts` that runs the selected button's prompt against the query via `requestGptAnswer`.
- [x] Implement optional `live_answer` (off by default) with `debounce_ms` debouncing for query-driven live results.
- [x] Add a sample `inlineMode` block to the global config in `generateConfig()` (`src/config.ts`) and confirm `checkConfigSchema()` does not warn.
- [x] Document inline mode in `README.md` (incl. enabling inline mode via BotFather).
- [x] write tests for inline query handling (button results, default Ask, live_answer off/on)
- [x] run project tests - must pass before next task

### Task 2: Secretary mode

- [x] Add `secretary?: { firstAnswerDelay: number; prompt?: string }` to `ChatParamsType` in `src/types.ts`.
- [x] In `src/handlers/onTextMessage.ts` (`answerToMessage`), implement a per-chat debounce: first message starts a `firstAnswerDelay`-second timer, follow-ups within the window are added to history without answering, and the answer fires once on expiry; reset/extend correctly on new messages.
- [x] Apply `secretary.prompt` as the system message override (via `thread.nextSystemMessage` / `getSystemMessage`).
- [x] Ensure interaction with existing `activeResponses` abort logic is correct (no duplicate or orphaned answers).
- [x] Add a sample `secretary` block to `full-example.chatParams` in `generateConfig()` (`src/config.ts`).
- [x] Document Secretary Mode in `README.md`.
- [x] write tests for debounce batching and prompt override
- [x] run project tests - must pass before next task

### Task 3: Guest mode

- [x] Add `guestMode?: { prompt: string }` to `ConfigType` in `src/types.ts`.
- [x] In `src/handlers/access.ts` (`isMentioned`), allow processing when the bot is explicitly mentioned (tag/prefix) in a reply to another user while guest mode is enabled.
- [x] In `src/helpers/history.ts` (`buildUserMessage`/`addToHistory`), when guest mode applies to such a reply, add the replied-to message into thread history alongside the user's message (preserving continuity).
- [x] Apply `guestMode.prompt` as the system instruction for guest-mode turns.
- [x] Add a sample `guestMode` block to the global config in `generateConfig()` (`src/config.ts`).
- [x] Document Guest Mode in `README.md`.
- [x] write tests for reply-context inclusion and guest prompt
- [x] run project tests - must pass before next task

### Task 4: Verify acceptance criteria

- [x] verify all three features from Overview are implemented and configurable
- [x] run full project test suite (`npm run test-full`)
- [x] run project linter (`npm run lint src tests`) - all issues must be fixed
- [x] run `npm run format src tests`

## Post-Completion

*Items requiring manual intervention - no checkboxes, informational only*

- Enable **inline mode** for the bot in BotFather (`/setinline`) before inline queries will reach the bot.
- After merge, update any deployed `config.yml` to add `inlineMode` / `guestMode` (global) and per-chat `secretary` blocks where desired.
