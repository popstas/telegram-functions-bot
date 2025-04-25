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
- ... and thousands of tools from MCP

## Config
Empty `config.yml` should be generated. Fill it with your data:
- bot_name
- auth.token
- auth.chatgpt_api_key

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

## Running Tests

To run the tests, use the following command:

```bash
npm test
```

This will execute all unit and integration tests in the `tests` directory using the `jest` framework.

## TODO
- [ ] Tool change_access_settings, for add/remove users to/from adminUsers, privateUsers