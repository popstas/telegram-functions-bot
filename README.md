Telegram bot with functions tools.

[CHANGELOG.md](CHANGELOG.md)

## Features
- In comparsion with [popstas/telegram-chatgpt-bot](https://github.com/popstas/telegram-chatgpt-bot)
- Single answer to several forwarded messages to bot
- Bot can use tools to get answer
- Better fallback answer when telegram markdown is wrong
- Agent-like pipelines: bot can use several tools to get answer
- MCP support: use external tools and services to get answer
- Langfuse support: track chat history and tool usage
- Use agents as tools

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
- `read_knowledge_google_sheet` - questions and answers from Google Sheet
- `read_knowledge_json` - questions and answers from json file/url
- `ssh_command` - exec ssh shell command, single server from config
- ... and thousands of tools from MCP

## Config
Empty `config.yml` should be generated. Fill it with your data:
- bot_name
- auth.token
- auth.chatgpt_api_key

### Multiple Bots / Secondary bot_token

You can run multiple Telegram bots from a single instance using the `bot_token` field in each chat config.

#### Use cases
- Run several bots with different tokens from the same codebase (e.g., main bot and test bot, or bots for different groups).
- Per-chat bot tokens: assign a unique bot token to a specific chat, while others use the global token.

#### How it works
- The bot will launch an instance for every unique `bot_token` found in `config.chats` and for the global `auth.bot_token`.
- If a chat does not specify its own `bot_token`, it will use the global `auth.bot_token`.
- Only one instance per unique token is launched (deduplicated automatically).

#### Example config
```yaml
auth:
  bot_token: "123456:main-token"
  chatgpt_api_key: "sk-..."
chats:
  - name: "Main Chat"
    id: 123456789
    # uses global auth.bot_token
  - name: "Secondary Bot Chat"
    id: 987654321
    bot_token: "987654:secondary-token"
    bot_name: "secondary_bot"
```

#### Notes
- If you launch two bots with the same token, Telegram will throw a 409 Conflict error. The bot automatically avoids this by deduplication.
- You must set `bot_name` in a chat config.
- You can set `privateUsers` in a chat config for extended access control.

## Use agents as tools
You can use one bot as a tool (agent) inside another bot. This allows you to compose complex workflows, delegate tasks, or chain multiple bots together.

### How it works

- In your chat config, add a tool entry with `bot_name`, `name`, and `description`.
- The main bot will expose this agent as a tool function. When called, it will internally send the request to the specified bot, as if a user messaged it.
- The agent bot processes the request and returns the result to the main bot, which includes it in the final answer.

### Example config

```yaml
chats:
  - name: Main Bot
    id: 10001
    tools:
      - bot_name: tool_bot
        name: add_task
        description: "Adds a task to the task list."
  - name: Bot as tool
    id: 10002
    bot_name: tool_bot
    bot_token: "987654:tool-token"
    systemMessage: "You accept a task text and return a structured task."
```

### Example usage

- The main bot exposes the `add_task` tool.
- When the tool is called (e.g., by function-calling or via a button), the main bot sends the input text to `tool_bot`.
- The result (e.g., task created or error) is sent back and included in the main bot’s response.

### Notes
- The agent bot must be configured in `config.yml` with a unique `bot_name`.
- The tool interface expects an `input` argument (the text to send to the agent).
- You can chain multiple agents and tools for advanced workflows.


## MCP Integration

MCP (Model Context Protocol) provides external tools and services to the bot. MCP servers are defined in the `config.mcpServers` file, which lists available MCP endpoints used by all chats.

### config.mcpServers Format
- The format of `config.mcpServers` matches the structure used in Claude Desktop.
- It is a list of MCP server configurations, each specifying the server address and connection details.
- Example:
  ```yaml
  {
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-memory"
      ]
    }
  }
  ```

### Server Sharing
- All MCP servers listed in `config.mcpServers` are shared between all chats.
- There is currently no per-chat isolation of MCP servers; every chat can access all configured MCP tools.

### Chat Configuration (`tools`)
- Each chat's configuration should specify a `tools` list.
- The `tools` list should include the names of tools (from MCP) that are available to that chat.
- Example chat config snippet:
  ```yaml
  - name: Memory MCP agent
    id: -123123
    tools:
      - create_entities
      - create_relations
      - add_observations
      - delete_entities
      - delete_observations
      - delete_relations
      - read_graph
      - search_nodes
      - open_nodes
  ```
- The available tool names are fetched from the MCP servers listed in `config.mcpServers`.

Refer to the MCP and Claude Desktop documentation for further details on server configuration and tool discovery.

## Langfuse Setup

This bot supports [Langfuse](https://langfuse.com/) for tracing, analytics, and observability of chat and tool usage.

Add your Langfuse credentials to your config (e.g., `config.yml`):
```yaml
langfuse:
  secretKey: <your_secret_key>
  publicKey: <your_public_key>
  baseUrl: https://cloud.langfuse.com
```

## Running Tests

To run the tests, use the following command:

```bash
npm test
```

This will execute all unit and integration tests in the `tests` directory using the `jest` framework.

## TODO
- [ ] Tool change_access_settings, for add/remove users to/from adminUsers, privateUsers