# Design: Port from Telegraf to grammY

Date: 2026-07-05
Status: approved

## Goal and motivation

Replace `telegraf@4.16.3` with `grammy` as the Telegram framework, to unlock grammY's
actively-maintained Bot API coverage and plugin ecosystem (auto-retry, runner,
conversations, hydrate). The port targets behavior parity first; idiom adoption that
changes behavior lands separately after parity is verified.

## Decisions (recorded from brainstorming)

| Decision | Choice |
|---|---|
| Motivation | Unlock grammY features; adopt idioms/plugins where they simplify code |
| Git strategy | One port branch, sequenced commits, single PR |
| Approach | Refactor-first: Telegraf-safe pre-refactors land as the branch's first commits, then the swap |
| Plugins in port | `@grammyjs/auto-retry`, `@grammyjs/runner` (+ `sequentialize`) |
| Plugins deferred to follow-up PR | `@grammyjs/conversations` (formFlow rewrite), `@grammyjs/hydrate` |
| Deliberate behavior improvements | Answer `add_tool`/`add_skill` callback queries; HTTP emulation works from boot |
| Verification | `npm run test-full` + manual smoke pass against a dev bot token |

Why runner is in scope despite being "optional": Telegraf processes updates
concurrently; grammY's built-in `bot.start()` is strictly sequential. This bot runs
multi-second LLM/tool chains per message — without the runner, one slow chat blocks
every other chat. `sequentialize` keyed on chat id preserves per-chat ordering.

## Target stack

- `grammy@^1.44` (Bot API 10.x types via `@grammyjs/types`); `telegraf` removed
  entirely — no coexistence period.
- `@grammyjs/runner`: `run(bot)` per bot; `RunnerHandle` stored beside each bot;
  `sequentialize(ctx => chat-or-business-connection key)` as the first middleware.
- `@grammyjs/auto-retry`: installed via `bot.api.config.use(autoRetry(...))` on every
  bot with bounded attempts/delay. Raw API calls pass through transformers, so it also
  covers the raw `sendMessageDraft` call.
- One context flavor replaces today's scattered intersection casts:

  ```ts
  type BotContext = Context & {
    secondTry?: boolean;
    businessConnectionId?: string;
    businessOwnerUsername?: string;
    expressRes?: express.Response;
    noSendTelegram?: boolean;
    progressCallback?: (m: string) => void;
  };
  ```

  Used as `Bot<BotContext>` / `Context` param type everywhere.
- `useBot()` stays sync: constructs `Bot`, kicks off `bot.init()` (replaces the
  `bot.botInfo = await getMe()` assignment, which is illegal in grammY — `botInfo` is a
  throwing getter before init). Launch and HTTP paths await readiness before reading
  `bot.botInfo`.
- Proxy: `{ telegram: { agent } }` → `{ client: { baseFetchConfig: { agent } } }`.
  Least-documented mapping; smoke-test immediately after the bot.ts commit.

## Phase plan (one branch; each phase = one or few commits)

### Phase 0 — Telegraf-safe pre-refactors (tests green after each commit)

1. **Static callback handlers.** Kill runtime `bot.action()` registration
   (`src/telegram/confirm.ts`, `src/commands.ts`). grammY throws on handler
   registration after `bot.start()`, so this redesign is mandatory; doing it on
   Telegraf first isolates it (and fixes an existing handler leak).
   - Tool confirmation: static `bot.callbackQuery(/^confirm_(\d+)$/)` and
     `/^cancel_(\d+)$/` at init, resolving a module-level
     `Map<id, PendingConfirmation>`. Ids move from `Date.now()` (same-millisecond
     collision) to a monotonic counter. Unknown/expired id →
     `answerCallbackQuery("expired")`.
   - `/add_tool`, `/add_skill`: payload already lives in `callback_data`, so per-click
     registrations collapse into static regex handlers, no map. New handlers answer
     their callback queries (today they don't — approved improvement).
   - Handlers registered per bot in `launchBot` (covers the multi-bot registry).
2. **Raw keyboards.** Replace `Markup.*` with raw `{ reply_markup }` literals in
   `formFlow.ts`, `onTextMessage.ts`, and the `send.ts` signature
   (`Markup.Markup<ReplyKeyboardMarkup>` → plain types). Telegraf `Markup.*` returns a
   `{ reply_markup }` wrapper that call sites spread; grammY keyboard instances ARE the
   reply_markup value — any missed site would send messages with no keyboard and no
   error. Raw literals (already the pattern in confirm.ts/commands.ts) remove the trap
   before the swap.
3. **Error helper.** Extract `src/telegram/errors.ts`: `getRetryAfterMs(err)`,
   `isBlockedByUser(err)`, `isInvalidToken(err)`, `getErrorDescription(err)`.
   Phase 0 implements it over Telegraf's `err.response.*`; Phase 2 swaps internals to
   `GrammyError`/`HttpError` (fields move to top level) without touching call sites.
   Covers: four streaming 429 loops, send.ts 403 blocked-user branch, index.ts 401
   token probe, vision.ts `"wrong file_id"` message sniffing.
4. **Chat-action helper.** Extract `withChatAction(ctx, action, fn)` wrapping
   `ctx.persistentChatAction` and its three synthetic-context stubs. grammY has no
   `persistentChatAction`; post-swap the helper becomes a `sendChatAction` interval
   loop (~4–5 s) until `fn` settles, supporting `business_connection_id` (so the
   Business stub becomes a real typing indicator) and no-op when `ctx.noSendTelegram`.
   The 13 test files stubbing `ctx.persistentChatAction` shift to mocking one module.
5. **Type-alias file.** `src/telegram/types.ts` re-exporting the Telegraf-only
   namespace types used at ~20 sites (`Chat.TitleChat`, `Update.MessageUpdate`,
   `Update.EditedMessageUpdate`, `Update.CallbackQueryUpdate`,
   `Update.ChosenInlineResultUpdate`, `Update.MessageReactionUpdate`) — none exist in
   `@grammyjs/types`. Post-swap the file redefines them via indexed access
   (`NonNullable<Update["message_reaction"]>` etc.). Also: delete the dead
   `forward_from` branch in `history.ts` (field removed from Bot API).

### Phase 1 — Foundations

6. Install `grammy`, `@grammyjs/runner`, `@grammyjs/auto-retry`; define `BotContext`.
7. Repo-wide mechanical import swap `telegraf/types` → `grammy/types` (~40 files,
   src + tests; `Message`, `Message.TextMessage`, `Chat`, `User`, `Update`,
   `InlineQueryResultArticle`, keyboard markup types all exist verbatim — shared
   typegram ancestry).
8. Port `src/bot.ts`: `Bot<BotContext>`, proxy via `client.baseFetchConfig.agent`,
   `bot.init()` with stored readiness promise, `autoRetry` transformer, async
   SIGINT/SIGTERM handlers. **Smoke-test proxy startup immediately.**
9. Port `src/telegram/context.ts` + `src/helpers/lastCtx.ts` (keystone):
   - `createNewContext(ctx, newMsg)` → `new Context({ ...ctx.update, message: newMsg },
     ctx.api, ctx.me)` + `attachFlavor(from, to)` copying the flavor props. Today's
     descriptor-cloning breaks silently on grammY (message/chat/from are getters).
   - Five re-dispatch paths funnel through it: audio→text, photo/OCR→text,
     document→text, reaction→text, business→text.
   - HTTP/MQTT synthetic contexts stop depending on a stored last context (today:
     `{} as Context` sentinel crashes if HTTP fires before the first real message).
     New: get `api` + `me` from `useBot(token)` after awaiting init, build a synthetic
     update, construct a real `Context`, attach `expressRes`/`noSendTelegram` flavor.
     HTTP emulation works from boot (approved improvement).

### Phase 2 — Send/streaming layer

10. `src/telegram/send.ts`: `telegram` → `api`; `editMessageText` drops the
    `undefined` inline positional arg (grammY: `(chatId, msgId, text, other)`);
    `Input.fromBuffer/fromLocalFile` → `new InputFile(...)`; error branches through
    `errors.ts`; `reply_to_message_id` → `reply_parameters: { message_id }`
    (grammY typings reject the old key — coordinate with handler callers);
    signature retype after Markup removal.
11. `src/helpers/gpt/streaming.ts`: `api` rename; `safeSend/safeEdit/safeDelete/
    safeSendDraft` keep names and no-throw semantics but lose retry loops (auto-retry
    owns 429). `sendMessageDraft` is NOT in the Bot API — stays a raw call via
    grammY's `api.raw` proxy (forwards unknown method names; cast required). Draft
    flusher semantics preserved: in-flight-flush guard, empty-draft clear on finish,
    intentionally empty `sentMessages`.
12. `src/helpers/vision.ts`: `getFileLink().href` → `getFile()` +
    `https://api.telegram.org/file/bot<token>/<file_path>` with per-bot `bot.token`;
    error sniffing via `getErrorDescription`. The same `getFile` change in
    `onAudio.ts` lands in Phase 4 with the rest of that handler's edits.
13. `src/telegram/confirm.ts`: `answerCbQuery` → `answerCallbackQuery` (already static
    from Phase 0).

### Phase 3 — Lifecycle and entry point

14. `src/index.ts`:
    - Filters: `bot.on([message("text"), editedMessage("text")], ...)` →
      `bot.on(["message:text", "edited_message:text"], ...)`; media filters →
      `"message:photo"`, `"message:voice"`, etc. (keep explicit `message:` prefix —
      bare `:text` also matches channel posts).
    - `business_connection`, `business_message`, `message_reaction`,
      `chosen_inline_result` are natively typed — the `as unknown as "message"` casts
      disappear. Watch for new type errors in handlers built on the "it's a message"
      cast.
    - `bot.action` → `bot.callbackQuery`; `bot.help` → `bot.command("help")`.
    - `bot.catch((err, ctx))` → `bot.catch((err: BotError))` with `err.error` /
      `err.ctx`; discriminate `GrammyError`/`HttpError`. Mandatory for parity —
      grammY's default error handler stops the bot.
    - Launch: `await bot.init()` (401 rejects here → same log as today's probe), then
      `sequentialize` middleware, then `run(bot)` with snake_case `allowed_updates`
      (message, message_reaction, callback_query, inline_query, chosen_inline_result,
      business_connection, business_message — if dropped, those updates silently stop
      arriving). Runner task rejection feeds the existing `scheduleRestart`;
      `stopAllBots` awaits `handle.stop()`.
    - Rebuild `telegramPostHandler`/`telegramPostHandlerTest` on the Phase 1 synthetic
      Context; `healthcheck.ts` awaits init.
15. `src/commands.ts`: `bot.start(handler)` → `bot.command("start", ...)`;
    `ctx.startPayload` → existing `msg.text.split(" ")[1]` fallback; `setMyCommands`
    via `bot.api`.

### Phase 4 — Handlers and misc

16. All 11 `src/handlers/*`: `answerCbQuery` → `answerCallbackQuery`; `ctx.botInfo` →
    `ctx.me`; typed `getBusinessConnection`/`readBusinessMessage` (delete local shim
    types); `editMessageTextInline` for inline-message edits in `onInlineQuery.ts`
    (both call sites including the error-recovery catch path);
    `MaybeInaccessibleMessage` narrowing in `formFlow.ts` (`message` is optional;
    inaccessible → `date === 0`); `reply_parameters`; cast removal via native
    getters (`ctx.messageReaction`, `ctx.businessMessage`, `ctx.chosenInlineResult`).
17. `src/httpHandlers.ts`, `src/agent-runner.ts`, `src/helpers/*`, `src/tools/*`,
    `src/types.ts`: import/type swaps; duck-typed fake contexts
    (`{ noSendTelegram: true } as unknown as Context`) compile unchanged.
    `bot.botInfo.username` reads for multi-bot routing (`send.ts:79,225`,
    `context.ts:57`, `index.ts:358`, `healthcheck.ts:31`) are enumerated and changed
    deliberately — a missed read fails silently as wrong-bot routing.

### Phase 5 — Tests

18. `tests/bot.test.ts`: full rewrite (the only file mocking the `telegraf` package) —
    mock `grammy`'s `Bot`, assert new constructor option shape, init, stop.
19. ~17 files targeted edits: `telegram:` → `api:` fake keys (~14 files);
    429 fixtures to `GrammyError` shape (top-level `error_code`/`parameters`);
    `api.raw.sendMessageDraft` assertions; `editMessageTextInline` assertions
    (6+ in onInlineQuery tests); runner/init lifecycle fake in `index.start.test.ts`
    (grammY `start()` resolves on STOP — the launch-fake contract changes);
    `bot.callbackQuery` capture in commands/confirm tests; `answerCallbackQuery`;
    `ctx.me`; `getFile` fakes; chat-action helper mocks.
20. ~18 files: import-path swap only. Fix the 15 files importing a phantom `Context`
    from `telegraf/types` (nonexistent export — tests are not typechecked; all port
    breakage is runtime, mitigated by the Phase 0 src-level seams).
21. Follow CLAUDE.md testing patterns: update every
    `jest.unstable_mockModule` site when a source module's imports change.

### Phase 6 — Verification (before merge)

22. `npm run test-full` + `npm run format`.
23. Manual smoke pass against the dev bot token, in risk order:
    1. Startup through proxy (if `proxy_url` configured).
    2. Multi-bot launch; per-bot routing via `ctx.me.username`.
    3. **Two chats messaging simultaneously answered in parallel** (runner check).
    4. Streaming edit mode: long answer splitting + flood 429 (auto-retry).
    5. Streaming draft mode — confirms the backend still accepts raw
       `sendMessageDraft`, and that auto-retry interception doesn't break draft timing.
    6. Re-dispatch paths: voice→STT, photo OCR (with/without caption), document,
       reaction, business message (mark-as-read + typing indicator).
    7. Inline query → chosen result → inline message edit.
    8. Form flow: intro, text field extraction, `f:{i}:{j}` buttons, completion +
       `send_to` delivery.
    9. `/add_tool`, `/add_skill`, tool confirmation (redesigned static handlers),
       including two pending confirmations at once.
    10. HTTP emulation `POST /telegram/:chatId` before AND after the first real
        Telegram message.
    11. Blocked-user 403 path (block the dev bot from a test account).
    12. Graceful shutdown (SIGINT), restart-on-error path, `healthcheck.ts`.
24. Docs: README (framework mentions, any Telegraf-specific config docs),
    CLAUDE.md/AGENTS.md key-file descriptions that name Telegraf. No `ConfigType`
    changes → no `generateConfig()` changes.

## Follow-up PR (out of port scope; own design pass later)

- **formFlow on `@grammyjs/conversations`**: forms become conversation functions;
  state moves from `thread.formState` (in-memory today) to conversation state
  (default in-memory storage = parity). Decide then: keep `f:{i}:{j}` callback format
  vs conversation waits.
- **`@grammyjs/hydrate`**: handler-local ergonomics only. Hard rule: hydrated
  messages are never stored into thread history state (methods are silently lost on
  serialization).
- Optional hardening: typecheck `tests/` (the phantom-import class of rot is
  currently invisible).

## Risks (ranked, from the codebase audit)

1. Concurrency regression if runner is skipped or misconfigured — verify with the
   parallel-chats smoke test.
2. Dynamic handler registration throws at runtime post-start — eliminated in Phase 0.
3. Error-shape changes are silent (retry loops stop retrying, 403 branch misroutes;
   old-shape test fixtures keep passing) — centralized in `errors.ts`.
4. Synthetic-context machinery (descriptor clone, `{...lastCtx}` spread, `{} as
   Context` sentinel) breaks silently on getter-based grammY Context — Phase 1
   keystone, five features depend on it.
5. Keyboard wrapper-shape silent loss — eliminated in Phase 0 via raw literals.
6. `persistentChatAction` absent in grammY — one helper, 13 test files.
7. `ctx.botInfo` → `ctx.me` misses fail silently as multi-bot misrouting —
   enumerated call sites.
8. `editMessageText` positional changes may compile and put text in the wrong slot;
   inline variant needs `editMessageTextInline`.
9. `sendMessageDraft` is non-standard; verify backend accepts it through `api.raw` +
   transformers.
10. Bot API version jump (Telegraf ~7.x-era types → 10.x): expect unrelated new
    typecheck errors (`ChatFullInfo` split, `MaybeInaccessibleMessage`, removed
    fields); heavy `as unknown as` casting means some mismatches surface only at
    runtime.
11. `allowed_updates` snake_case: mistyped/dropped entries silently stop reaction/
    business/inline updates.
12. Proxy via `baseFetchConfig.agent` is unofficially documented — smoke-test first;
    a future grammY move to native fetch/undici would ignore the agent silently.

## Reference

Full per-file migration mapping (35 API surfaces → grammY equivalents with file:line
locations) lives in `2026-07-05-grammy-port-mapping.md` next to this spec; the
implementation plan enumerates per-file changes from it.
