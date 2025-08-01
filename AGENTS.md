# Guidelines

This project is a TypeScript Telegram bot. The codebase uses Node.js tooling with lint, formatting and tests.

## Rules on new features:
- Add tests for new features.
- Add documentation for new features.
- If config type was changed, change config.ts generateConfig function.
- **Never** change or delete files in `data/` directory in tests.

## Rules before commit
- Always run `npm run typecheck` before commit.
- Run `npm run test-full` before commit.
- Run `npm run format` before commit.

## Coverage improve rules
- Run `npm test` and `npm run coverage-info` to check coverage, sorted by lines_uncovered.
- Prefer less covered files.
- Cover each function first.
- Check `npm run test-full` and `npm run coverage-info` in the end of each iteration, calculate coverage change.

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



  - `index.ts` регистрирует обработчики `onTextMessage`, `onPhoto`, `onAudio` и `onUnsupported`.
  - Если сообщение аудио — выполняется speech-to-text (распознавание речи), результат добавляется в историю сообщений, как текст.
  - Если сообщение фото — извлекается текст с картинки (OCR); если к фото есть подпись (caption), она используется как промпт для задачи над изображением.
  - `checkAccessLevel` из `src/helpers/access.ts` проверяет уровень доступа и упоминание бота.
  - Загружаются пользовательские настройки или настройки группового чата.
  - Если у бота задан префикс и бот не указан явно (ник, reply, тег, префикс-команда), сообщение игнорируется.
  - `resolveChatButtons` ищет совпадения с кнопками и возвращает промпт.
  - Далее текст сообщения не анализируется, просто добавляется в историю чата `addToHistory`.

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
- Через адаптер добавляются mcp-функции от подключенных MCP-серверов (если такие есть и они активны).
- Формирование массива инструментов:
- Инструменты (tools) для запроса формируются из встроенных tools + mcp-функций.
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
