Telegram bot with functions tools.

[![Coverage Status](https://coveralls.io/repos/github/popstas/telegram-functions-bot/badge.svg?branch=master)](https://coveralls.io/github/popstas/telegram-functions-bot?branch=master)

[CHANGELOG.md](CHANGELOG.md)

## Features

- In comparison with [popstas/telegram-chatgpt-bot](https://github.com/popstas/telegram-chatgpt-bot)
- Single answer to several forwarded messages to bot
- Bot can use tools to get answer
- Better fallback answer when telegram markdown is wrong
- Agent-like pipelines: bot can use several tools to get answer
- MCP support: use external tools and services to get answer
- Langfuse support: track chat history and tool usage
- Use agents as tools
- Agents can be triggered by name via HTTP or MQTT
- Incoming audio transcription using Whisper service
- Prompt placeholders: `{url:...}` and `{tool:...}` for dynamic content
- Photo messages and image documents are processed with OCR to extract text
- Dedicated log files for HTTP and MQTT activity
- Desktop launcher with tray controls and live log viewer ([docs/desktop-launcher.md](docs/desktop-launcher.md))
- Docker healthcheck endpoint for container monitoring
- GET `/agent/:agent` returns agent status
- Per-chat `http_token` overrides the global HTTP token
- Mark known users in history using `markOurUsers`
- Automatic history cleanup with `forgetTimeout`
- Abort previous answer if user sends a new message
- Optional delay between split messages
- Vector memory with `memory_search` and `memory_delete` tools (confirmation required for delete, optional automatic search)
- Dynamic reply buttons returned from LLM responses (enable with `chatParams.responseButtons`)
- Treat Telegram reactions as short messages (toggle with `chatParams.answerReactions`)
- Enforce structured outputs by setting `response_format` in chat configuration

## Desktop launcher

The project ships with a lightweight Electron wrapper so you can monitor the bot from the system tray on macOS, Windows, or Linux.

- **Start the desktop shell:** `npm run desktop`. The command launches Electron with the existing Node runtime so the same configuration is reused.
- **Tray controls:** start or stop the bot, show or hide the window, and open the local `data/` directory where log files live.
- **Live log viewer:** the window streams new entries from the running bot in real time, mirroring what hits `data/messages.log`
  without replaying historical lines. You can pause the stream, clear the list, switch between message and **Desktop** channels,
  and toggle automatic scrolling.
- **Desktop log file:** Electron lifecycle activity is also persisted to `data/electron.log` so you can review startup issues even
  if the renderer fails to load.
- **Graceful shutdown:** quitting the app stops running bots and MQTT connections before exiting.

For distribution, run `npm run build:dist` to bundle the Electron entry points and generate a Windows `.exe` installer in the
`dist/` directory. If you only need the JavaScript bundles (for custom packaging workflows), use `npm run build:electron`.

### Native modules (better-sqlite3)

Vector memory features rely on the native `better-sqlite3` bindings. The CLI entry point bundles a binary compatible with your local Node.js runtime, but Electron ships with its own Node version. To avoid repeated `ERR_DLOPEN_FAILED` traces the desktop launcher skips loading `better-sqlite3` until you explicitly opt back in. When you are ready to enable vector memory inside Electron:

1. Rebuild the module for Electron:
   ```bash
   npx electron-rebuild --only better-sqlite3
   ```
2. Launch the desktop shell with the opt-in flag so the runtime will load the rebuilt binding:
   ```bash
   BETTER_SQLITE3_ALLOW_ELECTRON=1 npm run desktop
   ```

Until the rebuild succeeds (or the opt-in flag is omitted) the bot continues to run, vector memory tools stay disabled, and a warning is logged to both the desktop console and `data/electron.log`.

## Pipeline

- Receive question
- Use tool to get answer, send tool usage to user
- Read tool answer, answer user

## Tools

- `brainstorm` - Useful tool for brainstorming and planning task
- `change_chat_settings` - Change chat settings in config.yml
- `change_access_settings` - Add/remove users to admin and private user lists in config.yml
- `get_next_offday` - count 4-days cycle: day, night, sleep, offday
- `forget` - Forget chat history
- `javascript_interpreter` - exec JavaScript code
- `obsidian_read` - return the contents of an Obsidian file specified by `file_path`, list of files pass to the prompt
- `obsidian_write` - append text to a markdown file specified by `out_file`
- `powershell` - exec PowerShell command, single server from config
- `read_google_sheet` - read Google Sheet
- `read_knowledge_google_sheet` - questions and answers from Google Sheet
- `read_knowledge_json` - questions and answers from json file/url
- `memory_search` - search messages saved with vector memory
- `memory_add` - add/store text into vector memory
- `memory_delete` - delete messages from vector memory after confirmation
- `ssh_command` - exec ssh shell command, single server from config
- `web_search_preview` - use OpenAI internal web search tool (only for Responses API)
- `image_generation` - generate images using OpenAI image model (only for Responses API)
- ... and thousands of tools from MCP

## Config

Empty `config.yml` should be generated. Fill it with your data:

- agent_name (optional, autogenerated from bot_name or chat name)
- bot_name (deprecated)
- auth.token
- auth.chatgpt_api_key
- stt.whisperBaseUrl
- http.http_token (per-chat tokens use chat.http_token)
- useChatsDir (optional, default `false`) – when enabled, chat configs are loaded from separate files
  inside `chatsDir` instead of the `chats` section of `config.yml`.
- chatsDir (optional, default `data/chats`) – directory where per-chat YAML files are stored when
  `useChatsDir` is turned on. Private chats are saved as `private_<username>.yml`.

When `useChatsDir` is enabled, the bot watches both `config.yml` and each chat file for changes and
automatically reloads updated settings. New chat files placed in the directory are also watched
automatically. Configuration files are written only when their content changes to avoid unnecessary
reloads.

You can convert your configuration between a single `config.yml` and per-chat files:

```bash
npm run config:convert split   # save chats to data/chats and enable useChatsDir
npm run config:convert merge   # read chats from data/chats and merge into config.yml
```

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
    agent_name: "secondary_bot"
```

#### Notes

- If you launch two bots with the same token, Telegram will throw a 409 Conflict error. The bot automatically avoids this by deduplication.
- You must set `agent_name` (autogenerated if missing). `bot_name` is deprecated.
- You can set `privateUsers` in a chat config for extended access control.

## Prompt placeholders

Prompt placeholders allow you to include dynamic content in your prompts by fetching data from external sources or executing tools.

### {url:...}

Fetches content from a URL and inserts it into the prompt.

- **Syntax**: `{url:https://example.com}`
- **Caching**: Results are cached for 1 hour (3600 seconds) by default, change with `placeholderCacheTime`
- **Example**: `Check this article: {url:https://example.com/latest-news}`

```yaml
# Example usage in a prompt
systemMessage: |
  Here's the latest news:
  {url:https://example.com/breaking-news}

  Summarize the key points above
chatParams:
  placeholderCacheTime: 60
```

### {tool:...}

Executes a tool and inserts its output into the prompt.

- **Syntax**: `{tool:toolName(arguments)}`
  - Arguments can be a JSON object or a string
  - If no arguments, use empty parentheses: `{tool:getTime()}`
- **Caching**: Results are not cached by default (set `placeholderCacheTime` to enable)
- **Example**: `Current weather: {tool:getWeather({"city": "New York"})}`

```yaml
# Example usage in a prompt
systemMessage: |
  Current weather:
  {tool:getWeather({"city": "London"})}

  Based on this weather, what should I wear today?
```

## Use Responses API

Responses API is a new feature of OpenAI that allows you to use tools and web search to get answers to user questions.

To use it, set `useResponsesApi` to `true` in the chat config.

You can tune reasoning effort and verbosity for the Responses API via the optional `responsesParams` section of the chat
configuration. Set `responsesParams.reasoning.effort` to control the model's planning depth and `responsesParams.text.verbosity`
to control how long the final answer should be:

```yaml
responsesParams:
  reasoning:
    effort: minimal # or low | medium | high
  text:
    verbosity: low     # or medium | high
```

These values are passed to `client.responses.create` calls so you can balance speed, reasoning depth and verbosity depending on
the chat requirements.

Work only with OpenAI models.

When enabled, the bot can use the `web_search_preview` tool to get web search results.
It can also generate images using the `image_generation` tool.

## Streaming API responses

Learn how to stream model responses from the OpenAI API using server-sent events.

By default, when you make a request to the OpenAI API, we generate the model's entire output before sending it back in a single HTTP response. When generating long outputs, waiting for a response can take time. Streaming responses lets you start printing or processing the beginning of the model's output while it continues generating the full response.

### Enable streaming

To start streaming responses, set `stream=True` in your request to the Responses endpoint:

```javascript
import { OpenAI } from "openai";
const client = new OpenAI();

const stream = await client.responses.create({
  model: "gpt-5",
  input: [
    {
      role: "user",
      content: "Say 'double bubble bath' ten times fast.",
    },
  ],
  stream: true,
});

for await (const event of stream) {
  console.log(event);
}
```

The Responses API uses semantic events for streaming. Each event is typed with a predefined schema, so you can listen for events you care about.

For a full list of event types, see the [API reference for streaming](/docs/api-reference/responses-streaming). Here are a few examples:

```python
type StreamingEvent =
| ResponseCreatedEvent
| ResponseInProgressEvent
| ResponseFailedEvent
| ResponseCompletedEvent
| ResponseOutputItemAdded
| ResponseOutputItemDone
| ResponseContentPartAdded
| ResponseContentPartDone
| ResponseOutputTextDelta
| ResponseOutputTextAnnotationAdded
| ResponseTextDone
| ResponseRefusalDelta
| ResponseRefusalDone
| ResponseFunctionCallArgumentsDelta
| ResponseFunctionCallArgumentsDone
| ResponseFileSearchCallInProgress
| ResponseFileSearchCallSearching
| ResponseFileSearchCallCompleted
| ResponseCodeInterpreterInProgress
| ResponseCodeInterpreterCallCodeDelta
| ResponseCodeInterpreterCallCodeDone
| ResponseCodeInterpreterCallIntepreting
| ResponseCodeInterpreterCallCompleted
| Error
```

### Read the responses

If you're using our SDK, every event is a typed instance. You can also identity individual events using the `type` property of the event.

Some key lifecycle events are emitted only once, while others are emitted multiple times as the response is generated. Common events to listen for when streaming text are:

```text
- `response.created`
- `response.output_text.delta`
- `response.completed`
- `error`
```

For a full list of events you can listen for, see the [API reference for streaming](/docs/api-reference/responses-streaming).

### Advanced use cases

For more advanced use cases, like streaming tool calls, check out the following dedicated guides:

- [Streaming function calls](/docs/guides/function-calling#streaming)
- [Streaming structured output](/docs/guides/structured-outputs#streaming)

### Moderation risk

Note that streaming the model's output in a production application makes it more difficult to moderate the content of the completions, as partial completions may be more difficult to evaluate. This may have implications for approved usage.

## Use agents as tools

You can use one bot as a tool (agent) inside another bot. This allows you to compose complex workflows, delegate tasks, or chain multiple bots together.

### How it works

- In your chat config, add a tool entry with `agent_name`, `name`, and `description`.
- The main bot will expose this agent as a tool function. When called, it will internally send the request to the specified bot, as if a user messaged it.
- The agent bot processes the request and returns the result to the main bot, which includes it in the final answer.

### Example config

```yaml
chats:
  - name: Main Bot
    id: 10001
    tools:
      - agent_name: tool_bot
        name: add_task
        description: "Adds a task to the task list."
  - name: Bot as tool
    id: 10002
    agent_name: tool_bot
    bot_token: "987654:tool-token"
    systemMessage: "You accept a task text and return a structured task."
```

### Example usage

- The main bot exposes the `add_task` tool.
- When the tool is called (e.g., by function-calling or via a button), the main bot sends the input text to `tool_bot`.
- The result (e.g., task created or error) is sent back and included in the main bot’s response.

### Notes

- The agent bot must be configured in `config.yml` with a unique `agent_name`.
- The tool interface expects an `input` argument (the text to send to the agent).
- You can chain multiple agents and tools for advanced workflows.

## Trigger agents by name

You can run any configured agent outside Telegram.

### CLI

CLI isn't working at this time, use scripts that calling curl.

```
npm run agent <agent_name> "your text"
```

### HTTP endpoint

POST `/agent/:agentName` with JSON `{ "text": "hi", "webhook": "<url>" }`.
Use header `Authorization: Bearer <http_token>`.

GET `/agent/:agentName` returns current agent status.

You can set `http_token` per chat in `config.yml`; it overrides the global token.

### HTTP tool call

POST `/agent/:agentName/tool/:toolName` with JSON `{ "args": { ... } }`.
Authorization is the same as for `/agent`.

### MQTT

Publish text to `<base><agent_name>`.
Progress messages go to `<base><agent_name>_progress` and the final answer to `<base><agent_name>_answer`.

## ollama models

Add to config.yml local model, use ollama url and model name, then define `local_model` in the chat settings:

```
local_models:
  - name: qwen3:4b
    model: qwen3:4b
    url: http://192.168.1.1:11434
chats:
  - id: 123
    name: Chat with qwen
    local_model: qwen3:4b
```

`/info` should return actual using model.

## MCP Integration

MCP (Model Context Protocol) provides external tools and services to the bot. MCP servers are defined in the `config.mcpServers` file, which lists available MCP endpoints used by all chats.

### config.mcpServers Format

- The format of `config.mcpServers` matches the structure used in Claude Desktop.
- It is a list of MCP server configurations, each specifying the server address and connection details.
- For streamable HTTP MCP servers, use the `url` property (e.g. `url: "http://localhost:8000/mcp"`). The `serverUrl` property is deprecated in favor of `url`.
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

## Evaluators

Evaluators are special agents that assess the quality and completeness of the bot's responses. They help ensure that the bot provides useful and complete answers to user queries.

### How Evaluators Work

1. After generating a response, the bot can optionally send both the original user request and the generated response to an evaluator.
2. The evaluator rates the response on a scale from 0 to 5 based on completeness and usefulness.
3. The evaluator provides a justification for the score and determines if the response is considered complete.
4. If the response is incomplete (score < 4), the evaluator can suggest improvements or additional information to include.

### Evaluator Response Format

Evaluators return a JSON object with the following structure:

```json
{
  "score": 4,
  "justification": "The response addresses the main points but could provide more specific examples.",
  "is_complete": true
}
```

### Configuring Evaluators

To enable evaluators for a chat, add an `evaluators` array to your chat settings. Each evaluator is configured with the following properties:

```yaml
chats:
  - name: "Chat with Evaluators"
    id: 123456789
    evaluators:
      - agent_name: "url-checker" # Name of the agent to use for evaluation
        threshold: 4 # Optional: minimum score to consider the response complete (default: 4)
        maxIterations: 3 # Optional: maximum number of evaluation iterations (default: 3)
  - name: "URL evaluator agent"
    agent_name: "url-checker"
    systemMessage: "Check for url in answer."
    completionParams:
      model: "gpt-5-nano"
```

### How Evaluators Are Used

- The `agent_name` specifies which agent to use for the evaluation. This agent should be defined in your configuration.
- The `threshold` (default: 4) sets the minimum score required for a response to be considered complete.
- The `maxIterations` (default: 3) limits how many times the evaluator will attempt to improve a response.

### Disabling Evaluators

To disable evaluators for a specific chat, simply omit the `evaluators` array from the chat configuration.

### Chat Configuration (`tools`)

- Each chat's configuration should specify a `tools` list.
- The `tools` list should include the names of tools (from MCP) that are available to that chat.

Other useful chat parameters include:

- `markOurUsers` – suffix to append to known users in history
- `forgetTimeout` – auto-forget history after N seconds
- `historyLimit` – maximum number of recent messages to keep in history (default: 20)
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

## Vector memory

Enable semantic memory with `chatParams.vector_memory`. Messages starting with `запомни` (any punctuation immediately after the keyword is ignored) are embedded and stored in a SQLite database using `sqlite-vec`. Use the `memory_add` tool to store entries programmatically, `memory_search` to find related snippets, or `memory_delete` to remove them after a preview and confirmation. Set `toolParams.vector_memory.alwaysSearch` to automatically search memory before answering. Adjust `toolParams.vector_memory.deleteMaxDistance` (default `1.1`) to limit how far results can be for deletions.

To prevent duplicates, each new entry is compared against existing memories; if the text is already present or the closest embedding is nearly identical, the save is skipped.

```yaml
chatParams:
  vector_memory: true
toolParams:
  vector_memory:
    dbPath: data/memory/default.sqlite
    dimension: 1536
    alwaysSearch: false
    deleteMaxDistance: 1.1
```

By default, databases are stored under `data/memory/`:

- private chats: `data/memory/private/{username}.sqlite`
- chats for specific bots: `data/memory/bots/{bot_name}.sqlite`
- group chats: `data/memory/groups/{chat_name_or_id_safe}.sqlite`

- The available tool names are fetched from the MCP servers listed in `config.mcpServers`.

Refer to the MCP and Claude Desktop documentation for further details on server configuration and tool discovery.

## Dynamic buttons

Enable the bot to return temporary reply buttons from the model's response. When `chatParams.responseButtons` is `true`, the model must return JSON with `message` and `buttons` fields (use an empty array if no buttons), which are shown to the user as a keyboard.

This feature works both with the OpenAI Responses API and with streaming mode; the JSON envelope is hidden from users.

```yaml
chatParams:
  responseButtons: true
```

Each button should contain `name` and `prompt`. When a user clicks a button, its `prompt` is sent as their next message.

To generate buttons automatically from the assistant's reply, enable `chatParams.responseButtonsAgent`. The bot will run the built-in `buttons` agent (defined in `internal-agents/buttons.yml`) with the final answer text and use the returned button list as the response keyboard. By default (`chatParams.responseButtonsMessage: true`), the bot sends a separate message with a Markdown list (`- button: prompt`) and attaches the buttons there, so the original answer formatting stays intact.

```yaml
chatParams:
  responseButtonsAgent: true
  responseButtonsMessage: true
```

## Telegram reactions

Reactions are treated as short messages that carry the reaction icon (custom emoji IDs are shown as `:id:`), so quick emoji fe
edback can steer the assistant without typing.

Disable reaction handling per chat when you don't want emoji inputs to start a new answer:

```yaml
chatParams:
  answerReactions: false
```

## Default response format

Set `response_format` in a chat configuration to force the model to reply in a specific structure.

```yaml
response_format:
  type: json_object
```

You can also provide a JSON Schema:

```yaml
response_format:
  type: json_schema
  json_schema:
    name: response
    schema:
      type: object
      properties:
        message: { type: string }
      required: [message]
```

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

## Development

The project uses a TypeScript configuration optimized for fast type checking:

- **NodeNext modules** – `module` and `moduleResolution` are set to `NodeNext`.
  All relative imports therefore require explicit file extensions (e.g. `import { x } from "./file.ts"`).
- **allowImportingTsExtensions** – enables importing `.ts` files directly during development.
- **incremental** and **assumeChangesOnlyAffectDirectDependencies** – cache build info in
  `node_modules/.cache/tsconfig.tsbuildinfo` and speed up subsequent runs of `tsc --noEmit`.
- **skipLibCheck** – skips type checking of declaration files.

Run `npm run typecheck` to perform a fast type-only build using these settings.
Run `npm run typecheck:native` to experiment with the TypeScript Native preview (`tsgo`) compiler.

## Telegram utilities

### telegramConfirm

Helper to ask a user for confirmation with inline Yes/No buttons.

```ts
import { telegramConfirm } from "./telegram/confirm";

await telegramConfirm({
  chatId,
  msg: message,
  chatConfig,
  text: "Are you sure?",
  onConfirm: async () => {
    /* confirmed */
  },
  onCancel: async () => {
    /* canceled */
  },
});
```
