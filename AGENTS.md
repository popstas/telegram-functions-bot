# Guidelines

This project is a TypeScript Telegram bot. The codebase uses Node.js tooling with lint, formatting and tests defined in `.windsurfrules`.

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
- `npm run lint` – check lint rules
- `npm run lint:fix` – automatically fix lint errors
- `npm run format` – format files with Prettier
- `npm run format:check` – verify formatting

## Rules from `.windsurfrules`

- Run `npm run lint:fix` before `npm run lint`.
- Run `npm run format:check` and if it reports issues, run `npm run format`.
- When using `format` or `format:check`, specify the path to the file.

Follow these steps to keep the codebase consistent.
