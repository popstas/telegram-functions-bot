# Guidelines

This project is a TypeScript Telegram bot. The codebase uses Node.js tooling with lint, formatting and tests.

## Rules on new features:
- Add tests for new features.
- Add documentation for new features.
- If config type was changed, change config.ts generateConfig function.
- **Never** change or delete files in `data/` directory in tests.
- **Never** modify `CHANGELOG.md`; it is a generated file.

## Config type change checklist
When adding a field to `ConfigType` or `ConfigChatType` in `src/types.ts`:
1. Add the field to the type definition in `src/types.ts`.
2. Add a sample value to the `full-example` chat in `generateConfig()` in `src/config.ts` — otherwise `checkConfigSchema()` will warn on unknown fields.
3. Update README.md documentation.

## Testing patterns and pitfalls
- Tests use `jest.unstable_mockModule()` with dynamic `import()` in `beforeEach`. All mocks must be declared **before** the `import()` call.
- **When adding new imports to a source module**, all test files that mock that module must be updated to include the new exports. Search for `jest.unstable_mockModule(".../<module>")` across all test files. Common offenders:
  - `src/helpers/useTools.ts` is mocked in: `tests/helpers/useTools.test.ts`, `tests/helpers/gptTools.test.ts`, `tests/index.start.test.ts`
  - `src/mcp.ts` is mocked in: `tests/helpers/useTools.test.ts`, `tests/mcp.test.ts`, `tests/mcp.connect.test.ts`, `tests/helpers/useChatMcpTools.test.ts`
  - `src/config.ts` is mocked widely — ensure both `readConfig` and `useConfig` are present when a module imports either.
  - `src/telegram/send.ts` is mocked in many test files — ensure `sendTelegramMessage`, `isAdminUser`, `getFullName`, `sendTelegramDocument` are present.
- **When adding a parameter to an exported function**, update all test assertions that check the call with `toHaveBeenCalledWith()` — the new param appears as `undefined` in existing callers.
- Module-level caches (like `chatMcpState` in useTools.ts, `clients` in mcp.ts) should expose `__test` or `__testChatMcp` helpers for tests to reset state between runs.

## Rules before commit
- Always run `npm run typecheck` before commit.
- Run `npm run test-full` before commit.
- Run `npm run format` before commit.

## Release process
Releases are calendar-versioned `YYYY.M.D` (e.g. `2026.5.28`) and tagged `vYYYY.M.D`.

To cut a release from `master` (clean tree, all work merged):

```sh
npm version <YYYY.M.D>
```

This runs the npm lifecycle, which does everything:
1. `version` script — regenerates `CHANGELOG.md` via `conventional-changelog` (angular preset) and stages it. **Never** edit `CHANGELOG.md` by hand.
2. Bumps `package.json`, commits as `<YYYY.M.D>`, and creates the `v<YYYY.M.D>` tag.
3. `postversion` script — `git push` then `npm run release`, which creates the GitHub release via `conventional-github-releaser` (needs `CONVENTIONAL_GITHUB_RELEASER_TOKEN`).

Notes:
- Only `feat:` and `fix:` commits appear in the changelog / release notes; `chore:`/`docs:`/`task:` are excluded.
- Pick the version from today's date (year.month.day). Confirm the number before running — the scheme is not strictly monotonic across past tags.
- Verify after: `git ls-remote --tags origin v<YYYY.M.D>` and `gh release view v<YYYY.M.D>`.

## Coverage improve rules
- Run `npm test` and `npm run coverage-info` to check coverage, sorted by lines_uncovered.
- Prefer less covered files.
- Cover each function first.
- Check `npm run test-full` and `npm run coverage-info` in the end of each iteration, calculate coverage change.

# Pull request naming
Create name using angular commit message format.
`feat:` and `fix:` are using in CHANGELOG.md. It's a release notes for users. Name your PRs in a way that it's easy to understand what was changed. Forbidden to use `feat:` and `fix:` prefixes for chore tasks that don't add new features or fix bugs.

## Project Structure

- **src/** – main source code (`bot.ts`, `config.ts`, helpers, tools, etc.)
- **tests/** – Jest test suite
- **testConfig.yml** – sample configuration
- **.windsurf/workflows/** – documentation for workflows

## Commands

Use the npm scripts for development:

- `npm start` – run the bot
- `npm test` – execute tests and then run typecheck
- `npm run typecheck` – TypeScript type check
- `npm run lint src tests` – check lint rules
- `npm run format src tests` – format files with Prettier
- `npm run format:check src tests` – verify formatting



## Key file relationships (MCP and tools)
- `src/types.ts` — `McpToolConfig`, `ChatToolType`, `ConfigChatType.mcpServers`
- `src/mcp.ts` — MCP client lifecycle: `init()`, `connectMcp()`, `callMcp()`, `disconnectMcp()`, `initChatMcp()`, `disconnectChatMcp()`
- `src/mcp-auth.ts` — OAuth provider (`FileOAuthProvider`) and pending auth management
- `src/helpers/useTools.ts` — Global tool loading (`initTools`), per-chat MCP tools (`useChatMcpTools` with lazy-init cache)
- `src/helpers/gpt/tools.ts` — `resolveChatTools()` merges global tools + per-chat MCP tools + agent tools; `executeTools()` runs tool calls
- `src/config.ts` — `generateConfig()` full-example defines schema; `checkConfigSchema()` validates against it

## Key file relationships (skills, reply context, streaming)
- `src/helpers/skills.ts` — Skills subsystem: `loadSkills()` scans `config.skillsDir` (default `skills/`) for `SKILL.md` dirs; `buildSkillTool()`/`loadSkillTools()` expose each as a `skill_<name>` tool that `exec`s a command with `cwd` = skill dir (mirrors `src/tools/powershell.ts`); appended to `globalTools` in `initTools()`. Types: `SkillType`, `ConfigType.skillsDir` in `src/types.ts`.
- `src/commands.ts` — `commandAddSkill()`/`handleAddSkill` implement the admin-only `/add_skill` command (mirrors `/add_tool`): lists discovered skills as inline buttons, adds `skill_<name>` to `chatConfig.tools[]` and `writeConfig()`s.
- `src/handlers/access.ts` — `shouldIncludeReplyInHistory()` decides reply-context inclusion (always on when the bot is mentioned, not gated on `guestMode`); `isGuestModeReply()` still drives the guest-mode prompt. Used by `addToHistory()` in `src/helpers/history.ts`.
- `src/helpers/gpt/streaming.ts` — `createFlusher()` (edit mode) and `createDraftFlusher()` (draft mode via raw `bot.telegram.callApi("sendMessageDraft", …)`); `handleStream()` picks by `chatParams.streamMode`. Gate is `chatParams.streaming`; mode is `ChatParamsType.streamMode?: "edit" | "draft"` in `src/types.ts`.

## Архитектура (кратко)
Входящее сообщение: определяется тип (текст; аудио → speech-to-text; фото/документ → OCR/vision, caption используется как промпт); `checkAccessLevel` (`src/handlers/access.ts`) проверяет доступ и упоминание бота; если задан prefix и бот не указан явно (ник, reply, тег, префикс) — сообщение игнорируется; `resolveChatButtons` сопоставляет текст с кнопками чата; затем текст добавляется в историю `addToHistory` (при `chatParams.markReplyToMessage: true` в историю добавляется префикс `[reply to: <дата>, {name}]`). Ответ: системный промпт (`getSystemMessage`) + инструменты (`resolveChatTools` в `src/helpers/gpt/tools.ts`: глобальные tools → per-chat MCP из `chatConfig.mcpServers` (lazy-init, `useChatMcpTools`), переопределяют одноимённые → agent tools) → `requestGptAnswer`; tool calls исполняются (`executeTools`, `processToolResults`, `handleModelAnswer`) и результаты возвращаются в LLM рекурсивно до финального ответа. HTTP-интерфейс (`telegramPostHandler`/`telegramPostHandlerTest` в `index.ts`) эмулирует входящее сообщение и возвращает только финальный ответ.

## Form Flow (сбор данных через формы)
- Конфигурация в `chatParams.form` — массив форм с полями intro, end, message_template, send_to, items
- Типы полей: `text` (извлекается через LLM) и `button` (inline-кнопки Telegram)
- Состояние формы хранится в `thread.formState`
- При заполнении всех полей: отправляется end-сообщение, данные форматируются по шаблону и отправляются в указанные чаты
- Inline-кнопки используют короткий формат callback_data: `f:{fieldIndex}:{optionIndex}` (ограничение Telegram — 64 байта)
- LLM-агент `form-extractor` извлекает значения текстовых полей из произвольного текста пользователя
- Обработчик: `src/handlers/formFlow.ts`, интеграция в `onTextMessage.ts` после `resolveChatButtons`
