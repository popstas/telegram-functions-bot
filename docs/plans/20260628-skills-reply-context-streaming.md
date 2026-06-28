# Skills, reply-context history, and sendMessageDraft streaming

## Overview
Four queued features from `docs/TODO.md`, implemented in one plan:

1. **Skills (run commands from references)** — Introduce a Claude-Code-style "skill" concept: a
   `skills/` directory where each skill is a folder with `SKILL.md` (frontmatter `name` +
   `description`, body = usage instructions) and an optional `references/` subdir of scripts. The
   bot scans skills at startup, exposes each as a callable tool `skill_<name>`, and when the LLM
   invokes it the tool runs a command (python or other) with the working directory set to the
   skill folder so `references/*` scripts are reachable.
2. **Admin connects skills from Telegram** — An admin-only `/add_skill` command (mirroring the
   existing `/add_tool`) lists discovered skills as inline buttons; tapping one adds
   `skill_<name>` to the chat's `tools[]` and persists config.
3. **Reply-to-message context in history** — When an incoming message is a reply to another
   (non-bot) message and the bot is mentioned, the replied-to message is added to LLM history.
   This decouples the existing reply-inclusion behavior from global `guestMode` so it **always**
   happens when the bot is mentioned.
4. **New Telegram streaming mode (`sendMessageDraft`)** — Replace the "old way" (edit a real
   message every 2s) with Telegram Bot API 9.3+ `sendMessageDraft`, which pushes ephemeral
   partial text as the answer is generated, then persists one final message. Gated by a new
   per-chat option so the edit-based path remains available.

### Key design decisions (settled with maintainer)
- Skill model = **Claude-Code-style directories** (`SKILL.md` + `references/`). Each skill → one
  tool `skill_<name>`; the LLM passes a `command` to run inside the skill dir (same execution
  pattern as `src/tools/powershell.ts` / `ssh_command.ts`).
- Streaming = the **specific `sendMessageDraft` API** (Bot API 9.3 Dec 2025; all bots in 9.5
  Mar 2026). Telegraf 4.16.3 has no typed helper, so call it raw via
  `bot.telegram.callApi("sendMessageDraft", { chat_id, text, message_thread_id? })`. The draft is
  an ephemeral ~30s preview; the final message is persisted with the normal send path.
- Reply trigger = **always when mentioned** (no per-chat flag) — generalize `isGuestModeReply`.

## Context (from discovery)
- **Tool system**: `src/helpers/useTools.ts` `initTools()` scans `src/tools/*.ts` (each exports
  `call()` → `AIFunctionsProvider`) and appends MCP tools; `src/helpers/gpt/tools.ts`
  `resolveChatTools()` filters globals by `chatConfig.tools` names and merges per-chat MCP + agent
  tools; `executeTools()` runs them. Tool contract example: `src/tools/powershell.ts` (`call()`
  returns a provider with an `@aiFunction` method that `exec`s a command and returns
  `{ content }`).
- **Admin command pattern**: `src/commands.ts` `commandAddTool()` (lines 114-180) lists tools,
  registers `add_tool_<name>` inline-button actions, checks `includesUser(config.adminUsers, …)`,
  pushes the tool into `chatConfig.tools`, and `writeConfig()`s. Registered in `initCommands()`
  + `setMyCommands()`.
- **History / reply**: `src/helpers/history.ts` `addToHistory()` (lines 60-83) already pushes the
  replied-to message when `isGuestModeReply(msg, chatConfig)` is true — but that predicate
  (`src/handlers/access.ts:95-114`) requires `useConfig().guestMode?.prompt`. `buildUserMessage()`
  handles the separate `markReplyToMessage` metadata-prefix flag.
- **Streaming**: `src/helpers/gpt/streaming.ts` `createFlusher()` (lines 84-133) batches deltas and
  `safeSend`/`safeEdit`s every 2s; `handleStream()` (line 135+) drives it. `src/helpers/gpt/llm.ts`
  (~line 91) decides streaming via `chatConfig?.chatParams?.streaming && !noSendTelegram &&
  !hasImages`. Business chats disable streaming (`src/telegram/context.ts`).
- **Config/types**: `src/types.ts` `ConfigType`, `ConfigChatType`, `ChatParamsType`
  (`streaming?: boolean` line ~153, `markReplyToMessage?` line ~159). `src/config.ts`
  `generateConfig()` full-example defines the schema; `checkConfigSchema()` warns on unknown
  fields — every new field needs a sample there.

## Development Approach
- **Testing approach**: Regular (code first, then tests) — matches the project's established
  pattern. Tests are still mandatory per task (see below).
- Complete each task fully before moving to the next; small, focused changes.
- **CRITICAL: every task MUST include new/updated Jest tests** for the code it changes
  (success + error/edge cases), listed as separate checklist items.
- **CRITICAL: all tests must pass before starting the next task.**
- When adding imports to a mocked source module, update every `jest.unstable_mockModule(...)`
  site for it (see `CLAUDE.md` "Testing patterns and pitfalls"). Likely offenders here:
  `src/helpers/useTools.ts`, `src/telegram/send.ts`, `src/config.ts`, `src/commands.ts`.
- When adding a field to `ConfigType`/`ChatParamsType`, add a sample to the `full-example` chat in
  `generateConfig()` (`src/config.ts`) and document it in `README.md`.
- Run `npm run typecheck` and `npm test` after each task; maintain backward compatibility
  (edit-based streaming and guestMode paths must keep working).

## Testing Strategy
- **Unit tests**: required for every task (Jest, `npm test`).
- **E2E tests**: this project has no UI e2e harness. End-to-end verification is **manual against a
  live bot** (see Post-Completion) plus the HTTP emulation path where practical. Automated bar is
  the Jest suite + `npm run typecheck` + `npm run lint`.

## Progress Tracking
- Mark completed items `[x]` immediately when done.
- Add newly discovered tasks with ➕ prefix; blockers with ⚠️ prefix.
- Keep this plan in sync with actual work.

## What Goes Where
- **Implementation Steps** (`[ ]`): code, unit tests, docs — automatable by the agent.
- **Post-Completion** (no checkboxes): live-bot manual checks, Telegram API-version verification.

## Implementation Steps

### Task 1: Skill discovery and SKILL.md loader
- [x] Add `src/helpers/skills.ts` with `loadSkills(skillsDir?: string)` that scans the skills
      directory (default from new `config.skillsDir`, fallback `"skills"`), and for each subdir
      containing `SKILL.md` parses YAML frontmatter (`name`, `description`) + body instructions
      via `js-yaml` (already a dependency); returns `SkillType[]` `{ name, description,
      instructions, dir }`.
- [x] Define `SkillType` and `ConfigType.skillsDir?: string` in `src/types.ts`.
- [x] Handle missing dir / missing `SKILL.md` / malformed frontmatter gracefully (skip + `log`
      warn), never throw on startup.
- [x] Write tests for `loadSkills`: a valid skill, a skill missing frontmatter, a non-skill dir,
      and a missing `skillsDir` (use a temp fixtures dir under the test's own tmp — never touch
      `data/`).
- [x] Run tests — must pass before next task.

### Task 2: Expose each skill as a runnable `skill_<name>` tool
- [x] In `src/helpers/skills.ts`, add `buildSkillTool(skill): ChatToolType` that returns a tool
      whose `module.call()` yields a provider exposing one function named
      `skill_<name>` with input `{ command: string }` and description = skill description +
      instructions (so the model knows which `references/*` scripts exist).
- [x] Execute the command via `child_process.exec` with `cwd` = the skill dir (mirror
      `src/tools/powershell.ts`); capture stdout/stderr/exit code and return `{ content }` as a
      fenced code block; enforce a timeout and cap output length.
- [x] Append loaded skill tools to `globalTools` inside `initTools()` (`src/helpers/useTools.ts`),
      after the MCP block, guarded so failures don't break tool init.
- [x] Verify `resolveChatTools()` already includes them by name (they live in `globalTools`, so a
      chat listing `skill_<name>` in `tools[]` picks them up — confirmed; selection is by name in
      `resolveChatTools` and covered by `loadSkillTools` test producing matching names).
- [x] Write tests: tool exposed with correct name/schema; command runs with correct `cwd` and
      returns stdout (mock `child_process`); non-zero exit handled; missing skill → no tool.
- [x] Run tests — must pass before next task.

### Task 3: `/add_skill` admin command
- [x] Add `commandAddSkill(msg, chatConfig)` in `src/commands.ts` mirroring `commandAddTool`:
      list discovered skills, send inline buttons `add_skill_<name>`, and on tap verify
      `includesUser(config.adminUsers, username)` before adding `skill_<name>` to
      `chatConfig.tools[]` and `writeConfig()`.
- [x] Register `handleAddSkill` + `bot.command("add_skill", …)` in `initCommands()` and add it to
      `setMyCommands()` (admins only, like `/add_tool`).
- [x] Handle "no skills found" (reply with a helpful message) and de-dupe (don't add twice).
- [x] Write tests: admin adds a skill (config updated + persisted), non-admin tap is ignored,
      duplicate add is a no-op, empty skill list path. Update any `commands` mock sites for new
      exports.
- [x] Run tests — must pass before next task.

### Task 4: Reply-to-message context always added when mentioned
- [ ] In `src/handlers/access.ts`, add `shouldIncludeReplyInHistory(msg, chat)`: true when
      `msg.reply_to_message` exists, the replied-to author is not the bot and not the sender
      themselves. Keep `isGuestModeReply` (it still drives the guest-mode *prompt*), but no longer
      require `guestMode.prompt` for *history inclusion*.
- [ ] In `src/helpers/history.ts` `addToHistory()`, replace the `isGuestModeReply(...)` gate
      (line ~63) with `shouldIncludeReplyInHistory(...)` so the replied-to message is pushed to
      history whenever the bot is mentioned (private + group), independent of `guestMode`.
- [ ] Ensure no duplication: if the replied-to message is the bot's own prior answer it is skipped
      (already in history as assistant/system turn).
- [ ] Write tests in `tests/helpers/history.test.ts`: reply included without `guestMode` enabled;
      reply-to-bot skipped; reply-to-self skipped; non-reply unchanged. Update
      `tests/helpers/historyGuestMode.test.ts` expectations (reply now included even when guest
      mode disabled).
- [ ] Run tests — must pass before next task.

### Task 5: `sendMessageDraft` streaming mode
- [ ] Add `ChatParamsType.streamMode?: "edit" | "draft"` in `src/types.ts` (default behavior =
      `"edit"`, preserving current path); keep existing `streaming?: boolean` as the on/off gate.
- [ ] In `src/helpers/gpt/streaming.ts`, add `createDraftFlusher(bot, msg)` that on each flush
      calls `bot.telegram.callApi("sendMessageDraft", { chat_id, text, message_thread_id })`
      (raw, since Telegraf 4.16.3 lacks the typed method) instead of `safeSend`/`safeEdit`; on
      `finish()` it persists the final answer via the normal send path and clears the draft.
- [ ] In the flusher selection (in `createFlusher`/`handleStream` or `llm.ts`), pick the draft
      flusher when `streaming && streamMode === "draft"` and not a business chat; otherwise the
      edit flusher. Reuse `getRetryAfter`/`delay` for 429 handling on `callApi`.
- [ ] Surface the active mode in `/info` (`src/commands.ts` info message) next to "Streaming".
- [ ] Write tests in `tests/helpers/streaming.test.ts`: draft mode calls `callApi`
      `sendMessageDraft` with accumulated text + `message_thread_id`; finish persists a final
      message; edit mode path unchanged; 429 retry honored (mock `callApi`).
- [ ] Run tests — must pass before next task.

### Task 6: Config schema + verify acceptance criteria
- [ ] Add samples for `skillsDir` and `chatParams.streamMode` to the `full-example` chat in
      `generateConfig()` (`src/config.ts`) so `checkConfigSchema()` does not warn; run a config
      load to confirm no schema warnings.
- [ ] Verify all four Overview requirements are implemented and edge cases handled.
- [ ] Run full test suite (`npm run test-full` = tests + typecheck + lint) — all green.
- [ ] Run `npm run format src tests`.
- [ ] Verify coverage did not regress (`npm run coverage-info`).

### Task 7: [Final] Documentation
- [ ] Update `README.md`: skills (`skills/` layout, `SKILL.md`, `references/`, `skillsDir`),
      `/add_skill` admin command, reply-context-in-history behavior, and `streamMode: draft`
      (Bot API 9.3+ requirement).
- [ ] Note the `sendMessageDraft` Bot API version requirement and the always-on reply-context
      behavior change in the docs.
- [ ] Update project knowledge docs / `CLAUDE.md` "Key file relationships" if the skills module
      introduces a new subsystem worth indexing.

*Note: ralphex automatically moves completed plans to `docs/plans/completed/`.*

## Technical Details
- **Skill tool name**: `skill_<name>` (sanitize `name` to `[a-z0-9_]`). Description carries the
  SKILL.md body so the model knows which `references/*` scripts to call.
- **Skill execution**: `exec(command, { cwd: skill.dir, timeout, maxBuffer })`; return fenced
  stdout, or `Exit code: N` on failure (same shape as `powershell.ts`). Runs on the host with the
  bot user's privileges — admin-gated per chat, consistent with existing shell tools.
- **sendMessageDraft**: payload `{ chat_id, text, message_thread_id? }`; `text` may be empty since
  Bot API 10.0. Draft is ephemeral (~30s) and must be followed by a real `sendMessage` to persist.
  Frequent draft updates are acceptable (looser limits than message edits); still honor 429
  `retry_after`.
- **Reply inclusion shape**: push `{ role: "user", content: replyText, name: replyName }` before
  the current user message (unchanged from the current guest-mode block).

## Post-Completion
*Manual / external — no checkboxes, informational only.*

**Manual verification (live bot — maintainer):**
- Create a sample skill folder (`SKILL.md` + `references/hello.py`); run `/add_skill` as admin in
  a real chat; confirm the bot lists it, adds it, and that asking the bot to use it actually runs
  `references/hello.py` and returns output.
- In a group, reply to another user's message while mentioning the bot; confirm the bot's answer
  reflects the replied-to message content (history context), with `guestMode` disabled.
- Enable `streaming: true` + `streamMode: draft` on a chat and confirm the answer streams as a
  Telegram draft and then persists as a final message; confirm `edit` mode still works.

**External verification:**
- Confirm the target bot's Telegram Bot API backend is ≥9.3 (9.5 for all-bot availability) so
  `sendMessageDraft` is accepted; otherwise `streamMode: draft` should fall back to `edit`.
