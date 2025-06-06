import { Context } from "telegraf";
import { Message } from "telegraf/types";
import {
  ConfigChatButtonType,
  ConfigChatType,
  ThreadStateType,
} from "../types.ts";
import { sendTelegramMessage } from "./telegram.ts";

export default async function resolveChatButtons(
  ctx: Context,
  msg: Message.TextMessage,
  chat: ConfigChatType,
  thread: ThreadStateType,
  extraParams: Record<string, unknown>,
): Promise<Message.TextMessage | undefined> {
  let matchedButton: ConfigChatButtonType | undefined;
  const msgTextOrig = msg.text || "";
  const buttons = chat.buttonsSynced || chat.buttons;
  if (buttons) {
    matchedButton = buttons.find((b) => b.name === msgTextOrig);
    if (matchedButton) {
      if (matchedButton.waitMessage) {
        thread.activeButton = matchedButton;
        return await sendTelegramMessage(
          msg.chat.id,
          matchedButton.waitMessage,
          extraParams,
          ctx,
          chat,
        );
      }
      msg.text = matchedButton.prompt || "";
    }
  }

  const activeButton = thread?.activeButton;
  if (activeButton) {
    thread.messages = thread.messages.slice(-1);
    thread.nextSystemMessage = activeButton.prompt;
    thread.activeButton = undefined;
  }

  return undefined;
}
