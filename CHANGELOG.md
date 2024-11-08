# [](https://github.com/popstas/telegram-functions-bot/compare/v2024.11.3...v) (2024-11-08)


### Bug Fixes

* add username to log ([4b86efa](https://github.com/popstas/telegram-functions-bot/commit/4b86efad059ac4a79279a3c75105f92078cfbc58))
* comment console.log, log() fixes ([d611adc](https://github.com/popstas/telegram-functions-bot/commit/d611adcd683fa665ce4089fe98351f45f0e547ec))
* config read_knowledge_json -> knowledge_json ([863906b](https://github.com/popstas/telegram-functions-bot/commit/863906b2c129d3475ba2c81e76a3e6fdfe48228c))
* fix br in planfix_create_request_task response ([e1fa867](https://github.com/popstas/telegram-functions-bot/commit/e1fa8674692b977d8e296bf693194df0cdb5839f))
* fix copilot adminUsers code ([9c2ed0a](https://github.com/popstas/telegram-functions-bot/commit/9c2ed0a79f4900fdc3902575e669f89a2d011dbc))
* forget messages only after tool calling ([96bc33e](https://github.com/popstas/telegram-functions-bot/commit/96bc33ea7c74a76918df6d89f0175abf659d96d2))
* **gpt:** fix working multiple tool calls in single message ([afad6d8](https://github.com/popstas/telegram-functions-bot/commit/afad6d87e7088681db375654257cd2a82c3bb5c6))
* move chatTools prompts generate from buildMessages to getChatgptAnswer ([007b15c](https://github.com/popstas/telegram-functions-bot/commit/007b15c81e3b47cd7b462907e943d72eeca8d2a6))
* optional google auth ([49e62e4](https://github.com/popstas/telegram-functions-bot/commit/49e62e43f320382e91ae031730446d53375874e0))


### Features

* new function planfix_create_request_task ([07182fc](https://github.com/popstas/telegram-functions-bot/commit/07182fc42523938938c920f61b14b84e4e139c3f))



## [2024.11.3](https://github.com/popstas/telegram-functions-bot/compare/v2024.10.24...v2024.11.3) (2024-11-03)


### Bug Fixes

* **BREAKING:** change chat config: toolParams, chatParams ([8a4a0eb](https://github.com/popstas/telegram-functions-bot/commit/8a4a0ebdc4fc45821ce6ae16a34ef24e5e461638))
* hangle google refresh token ([44d76aa](https://github.com/popstas/telegram-functions-bot/commit/44d76aac210ccfec3abd902f5000c9c53d51d557))
* make working chats without functions, mark tool answer with tool_call_id ([e8b0f46](https://github.com/popstas/telegram-functions-bot/commit/e8b0f4696c91b810d1dfeb068ac476d6b66e21c5))
* optional chatConfig.id, override default chat config ([691f945](https://github.com/popstas/telegram-functions-bot/commit/691f945c8b4d9d69bdff63944e62fafd76cb2545))
* **read_knowledge_google:** cache sheet by id ([a712b54](https://github.com/popstas/telegram-functions-bot/commit/a712b547d3d232fea91b13e05575aadc4f98ee64))


### Features

* better messages history handle ([f5f2b82](https://github.com/popstas/telegram-functions-bot/commit/f5f2b829ae66587573da8f203173ef9433353b95))
* chat config: deleteToolAnswers ([d130402](https://github.com/popstas/telegram-functions-bot/commit/d13040213aff9286c6f2007da230ce87c588da50)), closes [#14](https://github.com/popstas/telegram-functions-bot/issues/14)
* get_next_offday, javascript_interpreter functions ([7870b1d](https://github.com/popstas/telegram-functions-bot/commit/7870b1d14137db24bef032da62d0ab23227b0743))
* **google:** use default service account ([e4412f8](https://github.com/popstas/telegram-functions-bot/commit/e4412f8c5e5195b00a776243a4bf5e32668ef880))
* many chat ids for single chat config ([a7e6cd8](https://github.com/popstas/telegram-functions-bot/commit/a7e6cd8b5a7d55dadb1658c73409554c418eb046))
* message new params: deleteAfter: timeout, deleteAfterNext: true ([25122cc](https://github.com/popstas/telegram-functions-bot/commit/25122cc351e03e8c3ca76739dab6a41b678fa42c))
* read_google_sheet, store google creds at data/creds.json ([abc573a](https://github.com/popstas/telegram-functions-bot/commit/abc573a6b51747c6b6362af487260c3e524b9f27))
* read_knowledge_google_sheet, faq bot with google sheets ([76f4064](https://github.com/popstas/telegram-functions-bot/commit/76f406408e8b6f38dc856bf82f1d785876849a95))



## [2024.10.24](https://github.com/popstas/telegram-functions-bot/compare/v2024.10.20...v2024.10.24) (2024-10-23)


### Bug Fixes

* fix confirmation, output command errors as expected behaviour, fix buttons ([46deb6e](https://github.com/popstas/telegram-functions-bot/commit/46deb6e8da59896810cc67f643367eada32e233c))
* obsidian_write without file_path, ssh -> ssh_command, better recursion tool usage answer ([833632e](https://github.com/popstas/telegram-functions-bot/commit/833632e85a1143ce64d0a8e6cf16411fcb678441))
* unify tool calls, split functions by chats ([62d63d3](https://github.com/popstas/telegram-functions-bot/commit/62d63d300feebaba828633aa349d68fbf836c247))


### Features

* chatConfig.confirmation ([940fa1a](https://github.com/popstas/telegram-functions-bot/commit/940fa1ae5cc587f6739466e76fc4cb612778580a)), closes [#9](https://github.com/popstas/telegram-functions-bot/issues/9)
* groupToolCalls, group commands to script for ssh ([7c8a2e2](https://github.com/popstas/telegram-functions-bot/commit/7c8a2e2935f43b534dc9ed83335190aef1b6918b))
* obsidian_read, obsidian_write functions, better online config update, functions prompts, resend message without markdown ([4d9d617](https://github.com/popstas/telegram-functions-bot/commit/4d9d617e1e06b4720f5a42f451a34982653f0005))



## [2024.10.20](https://github.com/popstas/telegram-functions-bot/compare/eb0544d9442dea95aee6cf781878b7251eea6222...v2024.10.20) (2024-10-20)


### Bug Fixes

* optional last_name, config.testUsers for call tools dryRun ([7c388f3](https://github.com/popstas/telegram-functions-bot/commit/7c388f30e214055fa0658c351a7bc1d676233cae))


### Features

* mvp ([eb0544d](https://github.com/popstas/telegram-functions-bot/commit/eb0544d9442dea95aee6cf781878b7251eea6222))
* telegram-functions-bot, with ssh function, from telegram-planfix-bot ([cc707b8](https://github.com/popstas/telegram-functions-bot/commit/cc707b82a96e9a2f7d50348dd3303cf8d94da403))



