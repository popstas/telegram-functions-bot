# Use proxy_url for Telegram API calls

## Overview
- Reuse existing `auth.proxy_url` config field to proxy Telegram Bot API requests through an HTTP/HTTPS proxy
- Currently `proxy_url` only applies to OpenAI API calls; this extends it to Telegraf
- Telegraf accepts `telegram.agent` option (Node.js `http.Agent`) — use `https-proxy-agent` (already installed) to create the agent

## Context
- `src/bot.ts` — `useBot()` creates `new Telegraf(bot_token)` without options
- `src/helpers/useApi.ts` — existing proxy pattern using `undici.ProxyAgent` for OpenAI
- `src/types.ts` — `ConfigType.auth.proxy_url` already exists
- `src/config.ts` — `generateConfig()` already has `proxy_url` in full-example
- Telegraf's `ApiClient.Options` accepts `agent?: http.Agent` for API calls
- `https-proxy-agent` package (v7.0.6) is already in dependencies

## Development Approach
- **Testing approach**: Regular (code first, then tests)
- Make minimal changes: only modify `src/bot.ts` to pass the agent option
- No type changes needed — `proxy_url` already in config

## Implementation Steps

### Task 1: Add proxy agent to Telegraf initialization
- [x] Import `HttpsProxyAgent` from `https-proxy-agent` in `src/bot.ts`
- [x] Read `proxy_url` from config in `useBot()`
- [x] Pass `telegram: { agent: new HttpsProxyAgent(proxy_url) }` as Telegraf options when `proxy_url` is set
- [x] Write tests for `useBot()` with and without proxy_url configured
- [x] Run tests — must pass before next task

### Task 2: Verify acceptance criteria
- [x] Verify proxy agent is passed to Telegraf when proxy_url is set
- [x] Verify no proxy agent when proxy_url is not set
- [x] Run `npm run test-full` (tests + typecheck + lint)
- [x] Run `npm run format`

### Task 3: [Final] Update documentation
- [x] Update README.md to document that proxy_url now applies to Telegram API calls too

## Technical Details
- `HttpsProxyAgent` from `https-proxy-agent` creates a Node.js `http.Agent` compatible with Telegraf
- Telegraf uses this agent for all Bot API HTTP requests (sendMessage, getUpdates, etc.)
- The same `proxy_url` value is used for both OpenAI (via `undici.ProxyAgent`) and Telegram (via `HttpsProxyAgent`) — different agent implementations because the HTTP clients differ

## Post-Completion
- Manual testing: verify bot connects through proxy in a real environment
- Verify polling and webhook modes both work through proxy
