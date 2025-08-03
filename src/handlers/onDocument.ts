import { Context } from "telegraf";
import { Message } from "telegraf/types";
import checkAccessLevel from "./access.ts";
import onTextMessage from "./onTextMessage.ts";
import onUnsupported from "./onUnsupported.ts";
import { processImageMessage } from "../helpers/vision.ts";
import { log } from "../helpers.ts";
import { createNewContext } from "../telegram/context.ts";

export default async function onDocument(ctx: Context) {
  if (!("message" in ctx.update)) return;

  const access = await checkAccessLevel(ctx);
  if (!access) return;
  const { msg: accessMsg, chat } = access;
  const msg = accessMsg as unknown as Message.DocumentMessage;

  const mime = msg.document?.mime_type || "";
  if (!mime.startsWith("image/")) {
    await onUnsupported(ctx);
    return;
  }

  const chatTitle = "title" in msg.chat ? msg.chat.title : "private_chat";
  log({
    msg: `[document] ${msg.caption || ""}`,
    logLevel: "info",
    chatId: msg.chat.id,
    chatTitle,
    role: "user",
  });

  if (msg.caption && msg.caption.length > 100) {
    log({
      msg: `[document] caption too long, skip ocr: ${msg.caption.length}`,
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

  await processImageMessage(ctx, msg, chat, "upload_document");
}
