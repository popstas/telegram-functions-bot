Telegram bot with functions tools.

[CHANGELOG.md](CHANGELOG.md)

## Features
- In comparsion with [popstas/telegram-chatgpt-bot](https://github.com/popstas/telegram-chatgpt-bot)
- Single answer to several forwarded messages to bot
- Bot can use tools to get answer
- Better fallback answer when telegram markdown is wrong
- Agent-like pipelines: bot can use several tools to get answer

## Pipeline
- Receive question
- Use tool to get answer, send tool usage to user
- Read tool answer, answer user

## Tools
- `brainstorm` - Useful tool for brainstorming and planning task
- `change_chat_settings` - Change chat settings in config.yml
- `get_next_offday` - count 4-days cycle: day, night, sleep, offday
- `javascript_interpreter` - exec JavaScript code
- `obsidian_read` - return the contents of an Obsidian file specified by `file_path`, list of files pass to the prompt
- `obsidian_write` - append text to a markdown file specified by `out_file`
- `planfix_create_request_task` - Creates new task in CRM Planfix
- `powershell` - exec PowerShell command, single server from config
- `read_google_sheet` - read Google Sheet
- `read_knowledge_google_sheet` - questions and ansers from Google Sheet
- `read_knowledge_json` - questions and ansers from json file/url
- `ssh_command` - exec ssh shell command, single server from config

## Config
Empty `config.yml` should be generated. Fill it with your data:
- bot_name
- auth.token
- auth.chatgpt_api_key

## Running Tests

To run the tests, use the following command:

```bash
npm test
```

This will execute all unit and integration tests in the `tests` directory using the `jest` framework.
