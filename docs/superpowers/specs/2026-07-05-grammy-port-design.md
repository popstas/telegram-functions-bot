# Design: Port from Telegraf to grammY

Date: 2026-07-05
Status: approved

## Goal and motivation

Replace `telegraf@4.16.3` with `grammy` as the Telegram framework, to unlock grammY's
actively-maintained Bot API coverage and plugin ecosystem (auto-retry, runner,
conversations, hydrate). The port targets behavior parity everywhere EXCEPT the
outbound send/streaming pipeline, which is deliberately rewritten on Bot API 10.1
rich messages (Phase 2 — approved scope revision); conversations/hydrate idiom
adoption lands separately after the port is verified.

## Decisions (recorded from brainstorming)

| Decision | Choice |
|---|---|
| Motivation | Unlock grammY features; adopt idioms/plugins where they simplify code |
| Git strategy | One port branch, sequenced commits, single PR |
| Approach | Refactor-first: Telegraf-safe pre-refactors land as the branch's first commits, then the swap |
| Plugins in port | `@grammyjs/auto-retry`, `@grammyjs/runner` (+ `sequentialize`) |
| Plugins deferred to follow-up PR | `@grammyjs/conversations` (formFlow rewrite), `@grammyjs/hydrate` |
| Deliberate behavior improvements | Answer `add_tool`/`add_skill` callback queries; HTTP emulation works from boot |
| Streaming (revised 2026-07-05) | Drop legacy edit-message streaming entirely; drafts via typed Bot API 10.1 `sendRichMessageDraft` |
| Outbound sends (revised 2026-07-05) | `sendRichMessage` (`{ markdown }`) becomes the default send path for ALL answers, replacing telegramify-markdown; legacy MarkdownV2 path retained only as fallback and for `plainText` sends |
| Config change | `ChatParamsType.streamMode` removed (`streaming: true` now always means rich-draft streaming) |
| Verification | `npm run test-full` + manual smoke pass against a dev bot token |

Why runner is in scope despite being "optional": Telegraf processes updates
concurrently; grammY's built-in `bot.start()` is strictly sequential. This bot runs
multi-second LLM/tool chains per message — without the runner, one slow chat blocks
every other chat. `sequentialize` keyed on chat id preserves per-chat ordering.

## Target stack

- `grammy@^1.44` (Bot API 10.1 types via `@grammyjs/types`); `telegraf` removed
  entirely — no coexistence period. Bot API 10.1 (2026-06-11) natively types
  `sendRichMessage`, `sendRichMessageDraft`, `sendMessageDraft`, and
  `InputRichMessage` (`{ markdown }` / `{ html }` content, `is_rtl`,
  `skip_entity_detection`) — no raw-API casts needed anywhere.
- `@grammyjs/runner`: `run(bot)` per bot; `RunnerHandle` stored beside each bot;
  `sequentialize(ctx => chat-or-business-connection key)` as the first middleware.
- `@grammyjs/auto-retry`: installed via `bot.api.config.use(autoRetry(...))` on every
  bot with bounded attempts/delay. All outbound calls — including the typed
  `sendRichMessage`/`sendRichMessageDraft` — pass through the transformer.
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

### Phase 2 — Rich outbound pipeline (send + streaming rewrite)

This phase is deliberately NOT parity (approved 2026-07-05): the outbound path moves
to Bot API 10.1 rich messages, and legacy edit-message streaming is deleted.

Verified API surface (from `@grammyjs/types` source):

```ts
sendRichMessage({ business_connection_id?, chat_id, message_thread_id?,
  direct_messages_topic_id?, rich_message: InputRichMessage, disable_notification?,
  protect_content?, allow_paid_broadcast?, message_effect_id?,
  suggested_post_parameters?, reply_parameters?, reply_markup? }): Message.RichMessageMessage
sendRichMessageDraft({ chat_id, message_thread_id?, draft_id, rich_message }): true
sendMessageDraft({ chat_id, message_thread_id?, draft_id, text?, parse_mode?, entities? }): true
```

`InputRichMessage` takes raw `{ markdown }` (or `{ html }`) — headings, code blocks,
tables, media, LaTeX — no parse_mode/entity juggling. Drafts are ephemeral ~30-second
previews; `draft_id` is client-generated and reusing it updates the draft in place
(undocumented but implied by the streaming purpose — verify in smoke test).

10. `src/telegram/send.ts` — rich-first outbound:
    - `sendTelegramMessage` sends via `api.sendRichMessage` with
      `rich_message: { markdown: text }`, passing through `reply_markup`,
      `reply_parameters`, `business_connection_id`, `message_thread_id`,
      `deleteAfter`/`plainText` custom params handling unchanged.
    - No message splitting on the rich path: rich messages support long content, so
      the `splitBigMessage` 4096-char chunking loop (and its 500 ms inter-chunk
      delay) does not apply to rich sends — one answer, one message.
    - Legacy path (`sendMessage` + telegramify-markdown MarkdownV2 +
      `splitBigMessage`) is retained for `plainText` sends and as automatic fallback
      when `sendRichMessage` fails (`GrammyError` — e.g. media-permission errors:
      markdown containing image URLs becomes media blocks, which require the bot to
      have media rights in the chat).
    - `telegramify-markdown` stays as a dependency for the fallback path only.
    - Also: `telegram` → `api`; `Input.fromBuffer/fromLocalFile` →
      `new InputFile(...)`; error branches through `errors.ts`;
      `reply_to_message_id` → `reply_parameters: { message_id }` (coordinate with
      handler callers); the remaining `editMessageText` call drops the `undefined`
      inline positional arg (grammY: `(chatId, msgId, text, other)`); signature
      retype after Markup removal.
    - Callers reading fields off the returned sent message must be checked:
      `sendRichMessage` returns `Message.RichMessageMessage`, not
      `Message.TextMessage` (`message_id`/`chat` present; `.text` is not).
11. `src/helpers/gpt/streaming.ts` — draft-only rewrite:
    - DELETE: `createFlusher` (edit-mode), `safeSend`, `safeEdit`, `safeDelete`,
      `getRetryAfter` and all hand-rolled retry loops (auto-retry owns 429; remaining
      errors warn-and-continue as today).
    - The single flusher streams via typed
      `api.sendRichMessageDraft({ chat_id, message_thread_id?, draft_id,
      rich_message: { markdown: fullText } })` on the existing 2 s cadence, one
      client-generated `draft_id` per answer (monotonic counter), preserving the
      in-flight-flush guard.
    - `finish()` clears the draft (empty draft update — `sendMessageDraft` explicitly
      allows empty text since 10.1; verify it clears a rich draft too, else send an
      empty-markdown rich draft) and hands `fullText` to the normal (now rich) send
      path, exactly as draft mode does today.
    - `handleStream`/`handleResponseStream`/`handleCompletionStream` finalize
      callbacks lose the `sentMessages` edit/delete machinery (edit-mode leftovers);
      `sentMessages` stays an always-empty array only if removing it from return
      shapes churns too many call sites — prefer removing it.
    - `ChatParamsType.streamMode` is removed from `src/types.ts`; `streaming: true`
      now always means rich-draft streaming. Config checklist applies: update
      `generateConfig()` full-example in `src/config.ts` and README (users with
      `streamMode` in configs get a `checkConfigSchema` unknown-field warning —
      intended).
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
    `tests/helpers/streaming.test.ts` largely rewritten — edit-mode flusher tests
    deleted, draft tests assert typed `api.sendRichMessageDraft({ chat_id, draft_id,
    rich_message })` calls; send tests grow rich-first assertions
    (`api.sendRichMessage` with `rich_message.markdown`) plus fallback-path cases;
    `editMessageTextInline` assertions (6+ in onInlineQuery tests); runner/init
    lifecycle fake in `index.start.test.ts` (grammY `start()` resolves on STOP — the
    launch-fake contract changes); `bot.callbackQuery` capture in commands/confirm
    tests; `answerCallbackQuery`; `ctx.me`; `getFile` fakes; chat-action helper
    mocks.
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
    4. Rich sends: an answer with headings, code blocks, and a table renders
       natively; an over-4096-char answer arrives as a single rich message (no
       splitting); forms/confirmation `reply_markup` buttons attach to rich
       messages; `plainText`/`deleteAfter` sends still use the legacy path.
    5. Rich-draft streaming: draft updates in place under the same `draft_id` on the
       2 s cadence; draft clears when the final answer arrives; flood 429 handled by
       auto-retry; fallback path fires when `sendRichMessage` is rejected (e.g. an
       answer with an image URL in a chat where the bot lacks media rights).
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
24. Docs: README (framework mentions, Telegraf-specific config docs, `streamMode`
    removal, rich-message streaming description), CLAUDE.md/AGENTS.md key-file
    descriptions that name Telegraf and the streaming section that documents
    `createFlusher`/`streamMode`. Config change: `ChatParamsType.streamMode` removed
    → `generateConfig()` full-example updated in the same commit (checklist from
    CLAUDE.md).

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
9. Rich outbound pipeline is new API surface (Bot API 10.1, released 2026-06-11):
   - `draft_id` update-in-place semantics are undocumented — verify on the dev bot.
   - Rich-draft clearing mechanism (empty draft) must be verified for the rich
     variant; plain `sendMessageDraft` explicitly allows empty text.
   - Long tool executions between flushes can exceed the ~30 s draft lifetime — the
     preview vanishes until the next flush; acceptable (it is a preview), but note it.
   - LLM markdown vs Telegram's rich-markdown dialect may diverge (auto entity
     detection can surprise; `skip_entity_detection` is the escape hatch).
   - Markdown containing image/media URLs becomes media blocks and requires media
     rights in the chat — the send fallback covers rejection, but rendering intent
     changes.
   - Rich messages support long content — no 4096-char splitting on the rich path;
     `splitBigMessage` survives only inside the legacy fallback/`plainText` path.
   - `sendRichMessage` returns `Message.RichMessageMessage` (no `.text`) — audit
     callers of `sendTelegramMessage` reading fields off the returned message.
   - `sendRichMessageDraft` has no `business_connection_id` — fine, business chats
     already disable streaming.
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
