Telegram bot with functions tools

## Pipeline
- Receive question
- Use tool to get answer, send tool usage to user
- Read tool answer, answer user

## Functions
- `ssh` - exec ssh shell command, single server from config
- `powershell` - exec PowerShell command, single server from config
- `obsidian_write` - append text to a markdown file specified by `out_file`
- `obsidian_read` - return the contents of an Obsidian file specified by `file_path`, list of files pass to the prompt
