import { Context } from "telegraf";
import { Message, Update } from "telegraf/types";
import onTextMessage from "./onTextMessage.ts";
import checkAccessLevel from "./access.ts";
import { processImageMessage } from "../helpers/vision.ts";
import { log } from "../helpers.ts";
import { createNewContext } from "../telegram/context.ts";

// Type guard to check if update has a message
function isMessageUpdate(update: Update): update is Update.MessageUpdate {
  return "message" in update;
}

export default async function onPhoto(ctx: Context) {
  if (!("message" in ctx.update) || !isMessageUpdate(ctx.update)) {
    return; // Not a message update
  }

  const access = await checkAccessLevel(ctx);
  if (!access) return;

  const { msg: accessMsg, chat } = access;
  const msg = accessMsg as unknown as Message.PhotoMessage;
  if (!msg.photo?.length) return;
  const chatTitle = "title" in msg.chat ? msg.chat.title : "private_chat";
  log({
    msg: `[photo] ${msg.caption || ""}`,
    logLevel: "info",
    chatId: msg.chat.id,
    chatTitle,
    role: "user",
  });

  if (msg.caption && msg.caption.length > 100) {
    log({
      msg: `[photo] caption too long, skip ocr: ${msg.caption.length}`,
      logLevel: "info",
      chatId: msg.chat.id,
      chatTitle,
    });

    const newMsg = {
      ...msg,
      text: msg.caption,
      entities: [],
    } as const;

    const contextWithCaption = createNewContext(ctx, newMsg);

    await onTextMessage(contextWithCaption);
    return;
  }

  await processImageMessage(ctx, msg, chat, "upload_photo");
}
