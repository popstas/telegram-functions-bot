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

  - `index.ts` регистрирует обработчики `onTextMessage`, `onPhoto`, `onAudio` и `onUnsupported`.
  - Если сообщение аудио — выполняется speech-to-text (распознавание речи), результат добавляется в историю сообщений, как текст.
  - Если сообщение фото — извлекается текст с картинки (OCR); если к фото есть подпись (caption), она используется как промпт для задачи над изображением.
  - `checkAccessLevel` из `src/helpers/access.ts` проверяет уровень доступа и упоминание бота.
  - Загружаются пользовательские настройки или настройки группового чата.
  - Если у бота задан префикс и бот не указан явно (ник, reply, тег, префикс-команда), сообщение игнорируется.
  - `resolveChatButtons` ищет совпадения с кнопками и возвращает промпт.
  - Далее текст сообщения не анализируется, просто добавляется в историю чата `addToHistory`. Если в chatParams включён `markReplyToMessage: true`, в начало содержимого пользовательского сообщения в истории добавляется префикс `[reply to: yyyy-mm-dd hh:ii:ss+00:00, {name}]`, чтобы модель видела контекст ответа на сообщение.

  - `resolveChatTools` в `src/helpers/gpt/tools.ts` собирает итоговый массив инструментов: сначала глобальные tools из `useTools()`, затем per-chat MCP tools из `useChatMcpTools()` (переопределяют глобальные с тем же именем), затем agent tools.
  - Используются функции `getSystemMessage`, `buildMessages`, `resolveChatTools` и `requestGptAnswer`.

  - Основные функции: `handleModelAnswer`, `executeTools` и `processToolResults`.

  - Маршруты реализованы в `telegramPostHandler` и `telegramPostHandlerTest` внутри `index.ts`.
Приложение telgram-functions-bot обрабатывает входящие сообщения, определяет их тип, проверяет права доступа, извлекает текст/контекст из медиа или кнопок, формирует историю сообщений. Дальнейшая обработка строится через генерацию промпта и инструментов для запроса к LLM. Ответ LLM может потребовать вызова встроенных или внешних инструментов, которые отрабатываются и результат передается LLM заново — так до получения финального ответа пользователю. Для внешней интеграции работает HTTP-интерфейс, который позволяет эмулировать сообщения от имени бота.

### Описание архитектуры и цепочки работы Telegram-бота
1. Входящее сообщение (onMessage)
- Определение типа сообщения:
- Работа с мультимедиа:
- Если сообщение аудио — выполняется speech-to-text (распознавание речи), результат добавляется в историю сообщений, как текст.
- Если сообщение фото — извлекается текст с картинки (OCR); если к фото есть подпись (caption), она используется как промпт для задачи над изображением.
- Проверки:
- Проверяется уровень доступа пользователя/чата.
- Загружаются пользовательские настройки или настройки группового чата.
- Обработка префикса:
- Если у бота задан префикс и бот не указан явно (ник, reply, тег, префикс-команда), сообщение игнорируется.
- Анализ кнопок чата:
- Если текст сообщения совпадает с одной из кнопок чата, из этой кнопки берется промпт.
- Передача сообщения:
- Далее текст сообщения не анализируется, просто передается в историю сообщений для чата.

2. Запрос к LLM (Large Language Model)
- Системный промпт:
- Формируется системный промпт, его содержимое может зависеть от настроек чата.
- К этому промпту могут добавляться промпты от встроенных инструментов (tools), если они включены в чате.
- Интеграция tools:
- Собираются все включенные встроенные инструменты (tools).
- Через адаптер добавляются mcp-функции от подключенных глобальных MCP-серверов (если такие есть и они активны).
- Добавляются per-chat MCP инструменты из `chatConfig.mcpServers` (lazy-init при первом сообщении, `useChatMcpTools` в `src/helpers/useTools.ts`). Per-chat MCP tools переопределяют глобальные с тем же именем.
- Формирование массива инструментов:
- Инструменты (tools) для запроса формируются из встроенных tools + глобальных mcp-функций + per-chat mcp-функций.
- Первый запрос к LLM:
- Готовится и отправляется запрос к LLM, передается история сообщений, системный промпт и инструменты.

3. Ответ LLM: цепочка вызовов инструментов
- Первые результаты:
- В ответе могут быть указания вызвать какой-либо инструмент (tool use).
- Вызов инструментов:
- Инструменты, указанные в ответе, вызываются.
- Результаты работы инструментов передаются во второй вызов LLM (рекурсивно).
- Рекурсия:
- LLM может еще раз вернуть запрос к тулу, либо дать финальный ответ.
- Завершение:
- Пользователь получает конечный ответ.

4. Отдельно: HTTP-интерфейс
- Симуляция сообщения:
- Можно отправить запрос в бот через HTTP-интерфейс, эмулируя любое сообщение в любом чате.
- В ответе HTTP возвращается только последний результат — цепочка работы не видна инициатору запроса.

5. Form Flow (сбор данных через формы)
- Конфигурация в `chatParams.form` — массив форм с полями intro, end, message_template, send_to, items
- Типы полей: `text` (извлекается через LLM) и `button` (inline-кнопки Telegram)
- Состояние формы хранится в `thread.formState`
- При заполнении всех полей: отправляется end-сообщение, данные форматируются по шаблону и отправляются в указанные чаты
- Inline-кнопки используют короткий формат callback_data: `f:{fieldIndex}:{optionIndex}` (ограничение Telegram — 64 байта)
- LLM-агент `form-extractor` извлекает значения текстовых полей из произвольного текста пользователя
- Обработчик: `src/handlers/formFlow.ts`, интеграция в `onTextMessage.ts` после `resolveChatButtons`
