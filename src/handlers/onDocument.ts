import { Context } from "telegraf";
import { Message, Update } from "telegraf/types";
import checkAccessLevel from "./access.ts";
import { handleImageMessage } from "../helpers/vision.ts";
import onUnsupported from "./onUnsupported.ts";

function isMessageUpdate(update: Update): update is Update.MessageUpdate {
  return "message" in update;
}

export default async function onDocument(ctx: Context) {
  if (!("message" in ctx.update) || !isMessageUpdate(ctx.update)) {
    return;
  }

  const access = await checkAccessLevel(ctx);
  if (!access) return;

  const { msg: accessMsg, chat } = access;
  const msg = accessMsg as unknown as Message.DocumentMessage;
  if (!msg.document) return;

  if (!msg.document.mime_type?.startsWith("image/")) {
    await onUnsupported(ctx);
    return;
  }

  await handleImageMessage(ctx, msg, msg.document.file_id, chat, "document");
}
