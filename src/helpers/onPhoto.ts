import { Context } from "telegraf";
import { Message } from "telegraf/types";
import onMessage from "./onMessage.ts";
import { recognizeImageText } from "./vision.ts";

export default async function onPhoto(ctx: Context) {
  const msg = ctx.message as unknown as Message.PhotoMessage;
  if (!msg || !msg.photo?.length) return;
  const text = await recognizeImageText(msg);
  const caption = msg.caption ? msg.caption + "\n" : "";
  const newMsg = {
    ...msg,
    text: caption + text,
  } as unknown as Message.TextMessage;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx as any).message = newMsg;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (ctx.update as any).message = newMsg;
  await onMessage(ctx);
}
