import type { Chat, Update } from "grammy/types";

// Narrowed Bot API types that Telegraf ships as namespace members but grammY does
// not. Consumers import these aliases; the port only swaps this file's internals.
export type TitleChat = Exclude<Chat, Chat.PrivateChat>;
export type MessageUpdate = Update & Required<Pick<Update, "message">>;
export type EditedMessageUpdate = Update & Required<Pick<Update, "edited_message">>;
export type CallbackQueryUpdate = Update & Required<Pick<Update, "callback_query">>;
export type ChosenInlineResultUpdate = Update & Required<Pick<Update, "chosen_inline_result">>;
export type MessageReactionUpdate = Update & Required<Pick<Update, "message_reaction">>;
