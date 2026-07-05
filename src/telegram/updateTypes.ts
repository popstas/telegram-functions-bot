import type { Chat, Update } from "telegraf/types";

// Narrowed Bot API types that Telegraf ships as namespace members but grammY does
// not. Consumers import these aliases; the port only swaps this file's internals.
export type TitleChat = Chat.TitleChat;
export type MessageUpdate = Update.MessageUpdate;
export type EditedMessageUpdate = Update.EditedMessageUpdate;
export type CallbackQueryUpdate = Update.CallbackQueryUpdate;
export type ChosenInlineResultUpdate = Update.ChosenInlineResultUpdate;
export type MessageReactionUpdate = Update.MessageReactionUpdate;
