# TODO

- [x] Добавить возможность использовать скиллы: запускать python и другие команды из references скилла
- [x] Добавить возможность админу подключать скиллы прямо из чата Telegram
- [x] если сообщение - reply на другое сообщение с bot mention, то бот должен также использовать это сообщение в контексте, добавлять в history
- [x] support new telegram bot streaming mode instead of old way

## E2E verification
Each feature must be covered by Jest (`npm run test-full`) and additionally verified with a manual live-bot check in a real Telegram chat by the maintainer.
