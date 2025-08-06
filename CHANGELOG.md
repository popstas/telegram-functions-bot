# [](https://github.com/popstas/telegram-functions-bot/compare/v2025.6.1...v) (2025-07-02)

### Bug Fixes

- Remove deprecated showTelegramNames ([#100](https://github.com/popstas/telegram-functions-bot/issues/100)) ([84b6544](https://github.com/popstas/telegram-functions-bot/commit/84b65443fe468351dee627b79a2f95d9615aed49))
- restore buttons prompts working ([6f43251](https://github.com/popstas/telegram-functions-bot/commit/6f432519892eda7cfa217307a878de611b8bd601))

### Features

- markOurUsers ([0a71520](https://github.com/popstas/telegram-functions-bot/commit/0a71520002d62783db7d0f7af90ae74781bd5a7d))
- allow LLM to return dynamic reply buttons via `chatParams.responseButtons`,
  working with Responses API and streaming

## [2025.6.1](https://github.com/popstas/telegram-functions-bot/compare/v2025.6.5...v2025.6.1) (2025-07-01)

### Bug Fixes

- add agent name to http/mqtt log ([d611664](https://github.com/popstas/telegram-functions-bot/commit/d611664e75780bf9a9b8f3af49b939f5e52e35e8))
- add resender full name to planfix_add_to_lead_task ([958c7aa](https://github.com/popstas/telegram-functions-bot/commit/958c7aa47fcd37fd2690c15cb6179496998d3b17))
- addToHistory messages from http and mqtt ([7fc7b00](https://github.com/popstas/telegram-functions-bot/commit/7fc7b0006f5fe30d4741f7489f0414978ec57af7))
- append message history to planfix_add_to_lead_task ([b6abdac](https://github.com/popstas/telegram-functions-bot/commit/b6abdac49a8eb5dea72c15ffc98f666be3004a60))
- better healthcheck error output ([c73a6c5](https://github.com/popstas/telegram-functions-bot/commit/c73a6c55cdb37f4bed4455bd3804c280090738c3))
- context errors, add vision to config ([fb9a7b7](https://github.com/popstas/telegram-functions-bot/commit/fb9a7b73fbdea0ff61abad4efb30f39d2c07f3c9))
- delete tool planfix_create_request_task, use popstas/planfix-mcp-server ([d7ea910](https://github.com/popstas/telegram-functions-bot/commit/d7ea9109de966db8a5dd4fd915137d73d10e48bf))
- don't wait for 5 sec before answer ([8259113](https://github.com/popstas/telegram-functions-bot/commit/82591132f6b43a42a96b5de0ceb62dfaf1d29b04))
- Filter invalid tool messages, fix error 400 Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.([#76](https://github.com/popstas/telegram-functions-bot/issues/76)) ([dc9df77](https://github.com/popstas/telegram-functions-bot/commit/dc9df777d489944b5bbb8ff3843e106d4504ef88))
- finish process audio ([036305f](https://github.com/popstas/telegram-functions-bot/commit/036305f42732ed842144425881537f2269ed6da6))
- Improve isMentioned prefixless replies ([#91](https://github.com/popstas/telegram-functions-bot/issues/91)) ([2cbc956](https://github.com/popstas/telegram-functions-bot/commit/2cbc956fa63ffb8c40acbd3c813163977151d4c9))
- **langfuse:** use single trace for evaluations ([#54](https://github.com/popstas/telegram-functions-bot/issues/54)) ([a055e43](https://github.com/popstas/telegram-functions-bot/commit/a055e43a30dda095f1e766b9b97e218c9bc9440e))
- process unsupported message types ([0a45db7](https://github.com/popstas/telegram-functions-bot/commit/0a45db7cb3686d5f0839a7a7db36a13c2d7e4155))
- sanitize user name in buildMessages ([782551d](https://github.com/popstas/telegram-functions-bot/commit/782551d38b0b61ba13aaf90b413ee86f70104b57))
- skip check mention without prefix ([3bac7e6](https://github.com/popstas/telegram-functions-bot/commit/3bac7e6ce7590c9c41522ec8905f3113cc10fc1c))
- Use encodingForModel instead of hardcoded token encodings ([#77](https://github.com/popstas/telegram-functions-bot/issues/77)) ([e0a5b12](https://github.com/popstas/telegram-functions-bot/commit/e0a5b123f4354fabed579297fc507c14e70b9f66))
- use photo caption as prompt ([c654694](https://github.com/popstas/telegram-functions-bot/commit/c654694f28257369a9aaf5ac24edfbe7fa2c799e))

### Features

- abort previous answer when user sent new message ([343743a](https://github.com/popstas/telegram-functions-bot/commit/343743afa9d1a02ab88ade5587ec68f22cac4378))
- add audio transcription ([3b07d4b](https://github.com/popstas/telegram-functions-bot/commit/3b07d4b2157d1b8acfb6dd411101b35bc0a1c5a2))
- Add dedicated log files for HTTP and MQTT ([#51](https://github.com/popstas/telegram-functions-bot/issues/51)) ([089f12e](https://github.com/popstas/telegram-functions-bot/commit/089f12e4fc59337fdc895982253f72f8e7555599))
- Add Docker healthcheck ([#70](https://github.com/popstas/telegram-functions-bot/issues/70)) ([041c24e](https://github.com/popstas/telegram-functions-bot/commit/041c24ececbc21e140ee7c82a567d103169fa22e))
- Add evaluators ([#53](https://github.com/popstas/telegram-functions-bot/issues/53)) ([151fdd2](https://github.com/popstas/telegram-functions-bot/commit/151fdd248ef1c127d4ec73bc493100aab49a7ea7))
- add GET /agent/:agent, answer with agent status, secondary Telegram bot auth error handling ([4e03eff](https://github.com/popstas/telegram-functions-bot/commit/4e03eff49e8ce1941b80c46488af62d91ab11999))
- add hidden user's first name to the messages history ([3040d72](https://github.com/popstas/telegram-functions-bot/commit/3040d72161581c5b151f9b4e9ac359d4ea4371d2))
- Add per-chat http token ([#50](https://github.com/popstas/telegram-functions-bot/issues/50)) ([6be33a2](https://github.com/popstas/telegram-functions-bot/commit/6be33a2c176a853ff84eccc992bc00090ba3e603))
- add showTelegramNames setting ([d43ecec](https://github.com/popstas/telegram-functions-bot/commit/d43ecec9a0b9ff3b0c5585bc82961ed50e6eacdc))
- Add tool placeholders for prompts ([#65](https://github.com/popstas/telegram-functions-bot/issues/65)) ([4a03986](https://github.com/popstas/telegram-functions-bot/commit/4a039865761d4c6b798a43c924f62b82324fde35))
- Add URL placeholder in systemMessage support ([#64](https://github.com/popstas/telegram-functions-bot/issues/64)) ([b87fdd7](https://github.com/popstas/telegram-functions-bot/commit/b87fdd76c1517708049002af02f39246439f11c5))
- call agents via http and mqtt, wip cli ([#48](https://github.com/popstas/telegram-functions-bot/issues/48)) ([64e85db](https://github.com/popstas/telegram-functions-bot/commit/64e85db21a1dff0c65d963e52b6bccfc0a1375e5))
- Config schema runtime check, rename model to local_model ([#55](https://github.com/popstas/telegram-functions-bot/issues/55)) ([a02a4a5](https://github.com/popstas/telegram-functions-bot/commit/a02a4a519ca3d59d6bb4b578b369e93060d5bbbb))
- delay between split messages ([d0f09ff](https://github.com/popstas/telegram-functions-bot/commit/d0f09ff909acf54ff929af62e461156554890625))
- handle photo messages with OCR ([d0bc094](https://github.com/popstas/telegram-functions-bot/commit/d0bc0946c795c6c55578bfeb988390e0be284be5))
- Message history in http and mqtt by agent_name ([fdc86a5](https://github.com/popstas/telegram-functions-bot/commit/fdc86a5969f41cfd0b0f862858df5b78c87f438f))
- support history forget timeout in agent runner ([b1bf2c1](https://github.com/popstas/telegram-functions-bot/commit/b1bf2c162ced5800a9255afb9c6674c1408499aa))

## [2025.6.5](https://github.com/popstas/telegram-functions-bot/compare/v2025.5.1...v2025.6.5) (2025-06-05)

### Bug Fixes

- answer to message with [@mention](https://github.com/mention) or when answer to bot's message ([c8c98ca](https://github.com/popstas/telegram-functions-bot/commit/c8c98ca02bb0feac249a53fa717ce41f077e9136))
- forget messages fix ([c166a3a](https://github.com/popstas/telegram-functions-bot/commit/c166a3a9043fbe844a0ef3e2f0329ccab8da863f))
- forgot about tool use forgot ([4c729f0](https://github.com/popstas/telegram-functions-bot/commit/4c729f0e6c3274e37d32e128dd077ccf05832060))
- ignore mention login in private chats ([b4d8c9a](https://github.com/popstas/telegram-functions-bot/commit/b4d8c9ac89eaf2efd79c762448f7970c9f6e7e96))

### Features

- better support of input mcp servers, add sse mcp servers ([e229cb6](https://github.com/popstas/telegram-functions-bot/commit/e229cb6d4a49cb5ec1bff7a862f90f827fbffbed))
- data/last-config-change.diff ([0971f7f](https://github.com/popstas/telegram-functions-bot/commit/0971f7f25da0951f36e80cf9993a6f7088b20952))
- forget ([5e8d0b4](https://github.com/popstas/telegram-functions-bot/commit/5e8d0b4a3e6365535c025de60a5594522e1ab556))
- ollama models support, qwen3 support: <tool_call>, <think>, <final_answer> ([ad951e5](https://github.com/popstas/telegram-functions-bot/commit/ad951e523f461b2476322dc018672d00e2cbdcdd))
- support final message on forget tool ([#42](https://github.com/popstas/telegram-functions-bot/issues/42)) ([63040eb](https://github.com/popstas/telegram-functions-bot/commit/63040eb69de004407541bbcab4bbbfd81981dd6b))
- tool retrying, inject message history to planfix_add_to_lead_task ([06cd9e3](https://github.com/popstas/telegram-functions-bot/commit/06cd9e3a97847818ab0701405d4ecd7d788af47f))

## [2025.5.1](https://github.com/popstas/telegram-functions-bot/compare/v2025.3.4...v2025.5.1) (2025-05-14)

### Bug Fixes

- add "forwarded from" in getChatgptAnswer instead of onMessage ([0a44c35](https://github.com/popstas/telegram-functions-bot/commit/0a44c35eb44ec9c4f17acf78f9232536cb80cce2))
- add uvx for mcp in docker ([41844a1](https://github.com/popstas/telegram-functions-bot/commit/41844a105a5ec6a27314b06d56b31879fc787419))
- better tool call args messages ([458f730](https://github.com/popstas/telegram-functions-bot/commit/458f7304ec304b6b64db8ad8fa8a9c00237e7adb))
- better tool call params output ([79ba1ec](https://github.com/popstas/telegram-functions-bot/commit/79ba1ecfa66ba5ea955e7ee04d85beb07115fbbb))
- extend planfix api timeout to 30 sec ([74ae629](https://github.com/popstas/telegram-functions-bot/commit/74ae629c4be67ae58ace1532834a637ba07a38f2))
- langfuse: add username to trace name ([0ff5d48](https://github.com/popstas/telegram-functions-bot/commit/0ff5d4834ed1f451cd960cb97de6893309b835d0))
- **langfuse:** better sessionId ([5faeca2](https://github.com/popstas/telegram-functions-bot/commit/5faeca2541801d66a15e285d59939259608f0014))
- persistentChatAction in http requests ([905085b](https://github.com/popstas/telegram-functions-bot/commit/905085b89f9ba4a123edfea96caf46c9353e531f))
- persistentChatAction: tying ([bf41280](https://github.com/popstas/telegram-functions-bot/commit/bf41280b292874e4fa209db2448dac9090b5ff61))
- show planfix error, add client to task ([f72c303](https://github.com/popstas/telegram-functions-bot/commit/f72c30396b6cca5e5ac7a016c3e2a19e8a21df45))

### Features

- chatAsTool, use agents as tools for other agents ([5d1054d](https://github.com/popstas/telegram-functions-bot/commit/5d1054d20b59273164c26baa80e7b46019a76f9d))
- langfuse ([a44b4b9](https://github.com/popstas/telegram-functions-bot/commit/a44b4b9bb51fdba7a0a74e2b952a550dbafbb26b))
- langfuse monitoring support ([3049a92](https://github.com/popstas/telegram-functions-bot/commit/3049a92f491ee0a2755e894f058796ed959c9171))
- mcp servers support ([9c39ea4](https://github.com/popstas/telegram-functions-bot/commit/9c39ea403cb5a45cae12ce42eb25a25d6af5d033))
- multiple telegram bots ([ba237aa](https://github.com/popstas/telegram-functions-bot/commit/ba237aa422e7d69c0ad2760c4a6456d0a8ec6341))
- prettify single mcp tool: expertizeme_search_items, better markown and html output ([66da686](https://github.com/popstas/telegram-functions-bot/commit/66da686490bd57e159c90327d8a90d5c3a5f0b41))
- ToolBot.prompt_append support, chat's privateUsers, tool access ([e82423a](https://github.com/popstas/telegram-functions-bot/commit/e82423a42d3754d4ce2bc41f53a31ad23d891d97))

## [2025.3.4](https://github.com/popstas/telegram-functions-bot/compare/v2024.11.24...v2025.3.4) (2025-03-04)

### Bug Fixes

- Add optional chaining to prevent undefined property access in onMessage ([b62ca1d](https://github.com/popstas/telegram-functions-bot/commit/b62ca1deab7c7491413b2be00a8420e9e92dda6f))
- avoid tools leak with change_chat_settings ([bab1b34](https://github.com/popstas/telegram-functions-bot/commit/bab1b3415fb58e7d86150b9e4b9e22fd0057b094))
- ensureDirectoryExists for write log ([3ac7513](https://github.com/popstas/telegram-functions-bot/commit/3ac75137df8adeea1ed160d7c8822df4d3a6a3e8))
- onMessage: set callback as third arg ([a350704](https://github.com/popstas/telegram-functions-bot/commit/a3507041e9860f5825c50d9e81a0b436a06a4a41))
- **planfix_create_request_task:** create comment when task exists ([0832db3](https://github.com/popstas/telegram-functions-bot/commit/0832db3d2e9c64045ae95c5f837aeab721660040))
- **planfix:** Рекомендатель -> Реферал ([7001999](https://github.com/popstas/telegram-functions-bot/commit/70019997538c2d3004d25459a5db73eff6d68857))
- **planfix:** leave required only clientName and description ([88f6f5f](https://github.com/popstas/telegram-functions-bot/commit/88f6f5fb0889adea6d8487505491d877770c3b91))
- Resolve TypeScript type errors in index.ts: update, context, message ([d4c6f7a](https://github.com/popstas/telegram-functions-bot/commit/d4c6f7a1524bddf189bd16efc0fdb4ae4a399677))
- stop typing on error while answer ([8ef1602](https://github.com/popstas/telegram-functions-bot/commit/8ef16022e7c80677cc2b35eeb3b7c042be91ab7b))
- Update processToolResponse call to use object parameter style ([fbd5c9b](https://github.com/popstas/telegram-functions-bot/commit/fbd5c9ba16a95d5863878457cebe3412a5a50449))

### Features

- Add configurable contact map for Planfix task creation ([035794a](https://github.com/popstas/telegram-functions-bot/commit/035794afed07f3677ce106b584864485ba3d6304))
- add typecheck, eslint, prettier ([a5037aa](https://github.com/popstas/telegram-functions-bot/commit/a5037aa1950d891c8f154da28133dc0a870b4795))
- messages.log ([b528eb9](https://github.com/popstas/telegram-functions-bot/commit/b528eb9776d26bde4e71b835cc377e9a568b01b1))
- **planfix_create_request_task:** search by contact, create task with contact, as in Zapier ([64ed068](https://github.com/popstas/telegram-functions-bot/commit/64ed06852e96ef02ff9b5306e7a7a2034c57d0e5))
- **planfix:** check for created task before create ([97303db](https://github.com/popstas/telegram-functions-bot/commit/97303db56747f1161ef157cd724c652a5306c24e))
- Refactor GPT context handling with improved type safety ([3cfe7dc](https://github.com/popstas/telegram-functions-bot/commit/3cfe7dc64a863870517a652bf4fe888d111dff65))

## [2024.11.24](https://github.com/popstas/telegram-functions-bot/compare/v2024.11.17...v2024.11.24) (2024-11-23)

### Bug Fixes

- add chat id and username to /info ([9ea5a12](https://github.com/popstas/telegram-functions-bot/commit/9ea5a120b34d63b4d274231d0f8fab60f4176be4))
- speedup tests ([8b22350](https://github.com/popstas/telegram-functions-bot/commit/8b223507e6878b0b8b01c7623c012b6c4b5f6530))

### Features

- Add commands module to project structure ([0829218](https://github.com/popstas/telegram-functions-bot/commit/082921815826e75a65bcfbcfdce2200253d8caeb))
- Add tests ([#38](https://github.com/popstas/telegram-functions-bot/issues/38)) ([2d3ac83](https://github.com/popstas/telegram-functions-bot/commit/2d3ac83cfa7c785fe414aaab9b12ea1bd456b109)), closes [#37](https://github.com/popstas/telegram-functions-bot/issues/37)
- Add useApi helper hook for API interactions ([f25bfae](https://github.com/popstas/telegram-functions-bot/commit/f25bfae166f6519fdcc9e923f543b8fe9c9460c8))

## [2024.11.17](https://github.com/popstas/telegram-functions-bot/compare/v2024.11.10...v2024.11.17) (2024-11-17)

### Bug Fixes

- add some defaults to default chat generated config ([e60a72e](https://github.com/popstas/telegram-functions-bot/commit/e60a72e08329f3efe5ef897e9b3e447e472bdaf8))
- deleteToolAnswers: ms -> seconds ([622bbf1](https://github.com/popstas/telegram-functions-bot/commit/622bbf156b6b27a83bf5df9b13de7125a033492b))
- disable failover sendTelegramMessage without markdown, too often ([e58035b](https://github.com/popstas/telegram-functions-bot/commit/e58035bd6414ef9b508724d613648d015148616e))
- early return from onMessage, don't log all messages in groups ([eb3755f](https://github.com/popstas/telegram-functions-bot/commit/eb3755fa431aa3e528ab7d6e16d58956554c5c28))
- filter out change_chat_settings from /info ([e61d370](https://github.com/popstas/telegram-functions-bot/commit/e61d370954fefbc2bdb75ebc78d32dbece9b4371))
- fix disable confirmations after first confirm ([74e72e4](https://github.com/popstas/telegram-functions-bot/commit/74e72e4af90854176c8c9545c04344d7ca2708b5))
- fix freezing after previous commit ([7059147](https://github.com/popstas/telegram-functions-bot/commit/70591470cb7b93bc9f0863babea4c9866dbd9fc8))
- **http:** fix exception when http called before regular telegram message ([cb2c101](https://github.com/popstas/telegram-functions-bot/commit/cb2c10169fbf5985db98ad3885bdaa6fa6be8219))
- **log:** time in local timezone ([6113cc0](https://github.com/popstas/telegram-functions-bot/commit/6113cc016b2ac01fc503bb070fbd73dbb0cf3af1))
- **ssh:** better output when command returns exit code > 0 ([5890399](https://github.com/popstas/telegram-functions-bot/commit/5890399e0bd9df2c4f6f8ccd2db7de74b46c4c04))
- **ssh:** working ssh in docker, mount your ssh key ([4511638](https://github.com/popstas/telegram-functions-bot/commit/45116382f86ac725079338bfca2abcd9e957cdb2))

### Features

- add buttonSync feature from popstas/telegram-chatgpt-bot ([7b0a75e](https://github.com/popstas/telegram-functions-bot/commit/7b0a75ee04ca2dbdb63e8edefd8d5d71c0f20a8f))
- http server for answer to virtual messages ([4684d43](https://github.com/popstas/telegram-functions-bot/commit/4684d43dfbd4860c8ce1c79a9c291210622f4db8))
- memoryless chats: forget history after tool usage only for memoryless chats ([145401b](https://github.com/popstas/telegram-functions-bot/commit/145401b1e3fb48247deae36f08d234557f7d323e))
- send dialog to http request ([d19ee68](https://github.com/popstas/telegram-functions-bot/commit/d19ee6898ea9e2036bcf1c483fe5d001c8bb4c67))

## [2024.11.10](https://github.com/popstas/telegram-functions-bot/compare/v2024.11.3...v2024.11.10) (2024-11-09)

### Bug Fixes

- add username to log ([4b86efa](https://github.com/popstas/telegram-functions-bot/commit/4b86efad059ac4a79279a3c75105f92078cfbc58))
- allow admin using private chat ([9937f74](https://github.com/popstas/telegram-functions-bot/commit/9937f7483213fd94b908640c528a90bf07927f03))
- better logging ([4678515](https://github.com/popstas/telegram-functions-bot/commit/4678515be9e10af661b58fe1090f8e6d4a0c9579)), closes [#32](https://github.com/popstas/telegram-functions-bot/issues/32)
- BREAKING: move config.oauth_google to config.auth.oauth_google, rename config.proxyUrl to config.auth.proxy_url, config.allowedPrivateUsers to config.privateUsers, remove from chat config: progPrefix, progInfoPrefix, forgetPrefix ([4ab0036](https://github.com/popstas/telegram-functions-bot/commit/4ab003631a1d530d8a6a16d64198a071763b36c2))
- BREAKING: remove config.systemMessage, completionParams, helpText, timeoutMs, planfix ([886d51b](https://github.com/popstas/telegram-functions-bot/commit/886d51ba07f591f25244d80f8a834e901dc8cb34))
- BREAKING: rename functions to tools everywhere ([0732f13](https://github.com/popstas/telegram-functions-bot/commit/0732f13547d3f44dd31acceafd6704abcefdd4c5))
- **change_chat_settings:** describe params, add forgetTimeout, remove outer `settings` object ([0cb2794](https://github.com/popstas/telegram-functions-bot/commit/0cb2794851f822b5e932395e1434a53cd4c6af47))
- comment console.log, log() fixes ([d611adc](https://github.com/popstas/telegram-functions-bot/commit/d611adcd683fa665ce4089fe98351f45f0e547ec))
- config read_knowledge_json -> knowledge_json ([863906b](https://github.com/popstas/telegram-functions-bot/commit/863906b2c129d3475ba2c81e76a3e6fdfe48228c))
- fix br in planfix_create_request_task response ([e1fa867](https://github.com/popstas/telegram-functions-bot/commit/e1fa8674692b977d8e296bf693194df0cdb5839f))
- fix copilot adminUsers code ([9c2ed0a](https://github.com/popstas/telegram-functions-bot/commit/9c2ed0a79f4900fdc3902575e669f89a2d011dbc))
- forget messages only after tool calling ([96bc33e](https://github.com/popstas/telegram-functions-bot/commit/96bc33ea7c74a76918df6d89f0175abf659d96d2))
- **gpt:** fix working multiple tool calls in single message ([afad6d8](https://github.com/popstas/telegram-functions-bot/commit/afad6d87e7088681db375654257cd2a82c3bb5c6))
- move chatTools prompts generate from buildMessages to getChatgptAnswer ([007b15c](https://github.com/popstas/telegram-functions-bot/commit/007b15c81e3b47cd7b462907e943d72eeca8d2a6))
- optional google auth ([49e62e4](https://github.com/popstas/telegram-functions-bot/commit/49e62e43f320382e91ae031730446d53375874e0))
- remove config.functions ([d673fdd](https://github.com/popstas/telegram-functions-bot/commit/d673fdd78dad8d4327dce0ac23d17a02c3947d85))

### Features

- /add_tool to config from chat for adminUsers ([9b1bf27](https://github.com/popstas/telegram-functions-bot/commit/9b1bf27b482108b21e458214d01fc6867c4cdc16))
- add tool defaultParams to toolParams when /add_tool, update tools descriptions ([7cf1591](https://github.com/popstas/telegram-functions-bot/commit/7cf1591cc7c54a694b2fc194f76ca2fc5ad8f354))
- **change_chat_settings:** adminUsers can change chatParams now ([704afc3](https://github.com/popstas/telegram-functions-bot/commit/704afc324c1c62516cb990aca75042d4c5e10892))
- CONFIG env for multiple configs ([d3b0cce](https://github.com/popstas/telegram-functions-bot/commit/d3b0cceb3a69cc2c2729029de619f645b52d14ec))
- **info:** describe enabled tools at /info ([7f698ed](https://github.com/popstas/telegram-functions-bot/commit/7f698ed12280fbe61e5c213b66cafc622894186c))
- **logging:** add chat title to log ([4c8298d](https://github.com/popstas/telegram-functions-bot/commit/4c8298d8fce0f92c779d41bcd509f5fc0806dcef))
- new function planfix_create_request_task ([07182fc](https://github.com/popstas/telegram-functions-bot/commit/07182fc42523938938c920f61b14b84e4e139c3f))
- new tool: brainstorm, like gpt-o1 ([565cdba](https://github.com/popstas/telegram-functions-bot/commit/565cdba5eb2bc59a6c578ef1e94cbf0aa0a39edf))
- tool systemMessage for ssh_command ([9b3cebe](https://github.com/popstas/telegram-functions-bot/commit/9b3cebe76967f9dd4e199f5d498fef62d1a6b4f1))

## [2024.11.3](https://github.com/popstas/telegram-functions-bot/compare/v2024.10.24...v2024.11.3) (2024-11-03)

### Bug Fixes

- **BREAKING:** change chat config: toolParams, chatParams ([8a4a0eb](https://github.com/popstas/telegram-functions-bot/commit/8a4a0ebdc4fc45821ce6ae16a34ef24e5e461638))
- hangle google refresh token ([44d76aa](https://github.com/popstas/telegram-functions-bot/commit/44d76aac210ccfec3abd902f5000c9c53d51d557))
- make working chats without functions, mark tool answer with tool_call_id ([e8b0f46](https://github.com/popstas/telegram-functions-bot/commit/e8b0f4696c91b810d1dfeb068ac476d6b66e21c5))
- optional chatConfig.id, override default chat config ([691f945](https://github.com/popstas/telegram-functions-bot/commit/691f945c8b4d9d69bdff63944e62fafd76cb2545))
- **read_knowledge_google:** cache sheet by id ([a712b54](https://github.com/popstas/telegram-functions-bot/commit/a712b547d3d232fea91b13e05575aadc4f98ee64))

### Features

- better messages history handle ([f5f2b82](https://github.com/popstas/telegram-functions-bot/commit/f5f2b829ae66587573da8f203173ef9433353b95))
- chat config: deleteToolAnswers ([d130402](https://github.com/popstas/telegram-functions-bot/commit/d13040213aff9286c6f2007da230ce87c588da50)), closes [#14](https://github.com/popstas/telegram-functions-bot/issues/14)
- get_next_offday, javascript_interpreter functions ([7870b1d](https://github.com/popstas/telegram-functions-bot/commit/7870b1d14137db24bef032da62d0ab23227b0743))
- **google:** use default service account ([e4412f8](https://github.com/popstas/telegram-functions-bot/commit/e4412f8c5e5195b00a776243a4bf5e32668ef880))
- many chat ids for single chat config ([a7e6cd8](https://github.com/popstas/telegram-functions-bot/commit/a7e6cd8b5a7d55dadb1658c73409554c418eb046))
- message new params: deleteAfter: timeout, deleteAfterNext: true ([25122cc](https://github.com/popstas/telegram-functions-bot/commit/25122cc351e03e8c3ca76739dab6a41b678fa42c))
- read_google_sheet, store google creds at data/creds.json ([abc573a](https://github.com/popstas/telegram-functions-bot/commit/abc573a6b51747c6b6362af487260c3e524b9f27))
- read_knowledge_google_sheet, faq bot with google sheets ([76f4064](https://github.com/popstas/telegram-functions-bot/commit/76f406408e8b6f38dc856bf82f1d785876849a95))

## [2024.10.24](https://github.com/popstas/telegram-functions-bot/compare/v2024.10.20...v2024.10.24) (2024-10-23)

### Bug Fixes

- fix confirmation, output command errors as expected behaviour, fix buttons ([46deb6e](https://github.com/popstas/telegram-functions-bot/commit/46deb6e8da59896810cc67f643367eada32e233c))
- obsidian_write without file_path, ssh -> ssh_command, better recursion tool usage answer ([833632e](https://github.com/popstas/telegram-functions-bot/commit/833632e85a1143ce64d0a8e6cf16411fcb678441))
- unify tool calls, split functions by chats ([62d63d3](https://github.com/popstas/telegram-functions-bot/commit/62d63d300feebaba828633aa349d68fbf836c247))

### Features

- chatConfig.confirmation ([940fa1a](https://github.com/popstas/telegram-functions-bot/commit/940fa1ae5cc587f6739466e76fc4cb612778580a)), closes [#9](https://github.com/popstas/telegram-functions-bot/issues/9)
- groupToolCalls, group commands to script for ssh ([7c8a2e2](https://github.com/popstas/telegram-functions-bot/commit/7c8a2e2935f43b534dc9ed83335190aef1b6918b))
- obsidian_read, obsidian_write functions, better online config update, functions prompts, resend message without markdown ([4d9d617](https://github.com/popstas/telegram-functions-bot/commit/4d9d617e1e06b4720f5a42f451a34982653f0005))

## [2024.10.20](https://github.com/popstas/telegram-functions-bot/compare/eb0544d9442dea95aee6cf781878b7251eea6222...v2024.10.20) (2024-10-20)

### Bug Fixes

- optional last_name, config.testUsers for call tools dryRun ([7c388f3](https://github.com/popstas/telegram-functions-bot/commit/7c388f30e214055fa0658c351a7bc1d676233cae))

### Features

- mvp ([eb0544d](https://github.com/popstas/telegram-functions-bot/commit/eb0544d9442dea95aee6cf781878b7251eea6222))
- telegram-functions-bot, with ssh function, from telegram-planfix-bot ([cc707b8](https://github.com/popstas/telegram-functions-bot/commit/cc707b82a96e9a2f7d50348dd3303cf8d94da403))
