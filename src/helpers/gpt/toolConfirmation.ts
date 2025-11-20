import { Message } from "telegraf/types";

import { ConfigChatType } from "../../types.ts";

export function applyConfirmationOverride(
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
): ConfigChatType {
  let updatedConfig = chatConfig;

  if (msg.text.includes("noconfirm")) {
    updatedConfig = JSON.parse(JSON.stringify(chatConfig));
    updatedConfig.chatParams.confirmation = false;
    msg.text = msg.text.replace("noconfirm", "");
  } else if (msg.text.includes("confirm")) {
    updatedConfig = JSON.parse(JSON.stringify(chatConfig));
    updatedConfig.chatParams.confirmation = true;
    msg.text = msg.text.replace("confirm", "");
  }

  return updatedConfig;
}
