# TODO

- [x] Добавить возможность использовать скиллы: запускать python и другие команды из references скилла
- [x] Добавить возможность админу подключать скиллы прямо из чата Telegram
- [x] если сообщение - reply на другое сообщение с bot mention, то бот должен также использовать это сообщение в контексте, добавлять в history
- [x] support new telegram bot streaming mode instead of old way

## Post-merge follow-ups (grammY port, 2026-07-05)

From the final whole-branch review and live smoke testing; all agreed as post-merge, none block the port:

- [ ] **Inline queries: chosen result never resolves to an answer** — inline buttons/results appear, but choosing one shows a permanent hourglass placeholder (pre-existing, broken before the port too; observed live 2026-07-05). Investigate `onInlineQuery` chosen_inline_result → `editMessageTextInline` flow.
- [ ] Catch-all `callback_query` answerer registered last (`bot.on("callback_query", ctx => ctx.answerCallbackQuery())`) — clears the spinner on edge paths that currently never answer: form early-returns, wrong-user confirm clicks, `add_chat`, `inline_noop`.
- [ ] Streaming flusher hardening (`src/helpers/gpt/streaming.ts`): guard against a late queued flush repainting the draft after `finish()`; `try/finally` around the stream loop so an LLM stream error can't leave the 2s flush loop running forever.
- [ ] Restart path re-registers middleware on the cached Bot instance (`scheduleRestart` → `launchBot` on same bot) — guard registration or evict `bots[token]` on stop.
- [ ] `chatParams` declared required in `types.ts` but genuinely undefined at runtime for chats that omit it — make it optional (or normalize at config load) so the compiler catches the remaining unguarded reads (`history.ts:31`, `formFlow.ts:185`, `commands.ts:364`, `tools.ts:294` — all currently reachability-safe).
- [ ] Docs: mention `sequentialize` (per-chat serialization) and `@grammyjs/auto-retry` (429 handling) in AGENTS.md/README.
- [ ] Healthcheck edge: a chat with `bot_token` but no `bot_name` is never launched yet creates a registry entry → `/health` reports "not running" permanently.
- [ ] `pendingConfirmations` map has no expiry; an `onConfirm`/`onCancel` throw leaves the confirm promise hanging (pre-existing latent).
- [ ] Rich-message prompting: models often emit headings without `#` and single-line tables, so rich rendering shows plain text (verified: hand-built `# heading`/table markdown parses into native blocks). Consider a system-prompt hint that native markdown headings/tables are now supported.
- [ ] Drafts (`sendRichMessageDraft`/`sendMessageDraft`) return 400 `TEXTDRAFT_PEER_INVALID` in group chats (Telegram peer restriction, verified via minimal curl) — streaming draft UX works only in private chats; consider skipping draft flushes for group peers to avoid log noise.
- [ ] Whisper STT server `home.popstas.ru:5773` was unreachable during smoke (voice answers fail with connect timeout) — infra, not code.
- [ ] Planned follow-up PRs per spec: `@grammyjs/conversations` rewrite of formFlow; `@grammyjs/hydrate` adoption; typechecking `tests/`.

## E2E verification
Each feature must be covered by Jest (`npm run test-full`) and additionally verified with a manual live-bot check in a real Telegram chat by the maintainer.
