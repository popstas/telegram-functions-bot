import { Context } from "telegraf";
import { Message } from "telegraf/types";
import { useBot } from "../bot.ts";
import { sendTelegramMessage } from "./send.ts";
import { ConfigChatType } from "../types.ts";

/**
 * Send confirmation request with inline buttons and resolve based on user choice.
 *
 * @param chatId chat identifier
 * @param msg original message for user context
 * @param chatConfig chat configuration
 * @param text confirmation text
 * @param onConfirm callback executed when user confirms
 * @param onCancel callback executed when user cancels
 * @param noSendTelegram optional flag to skip Telegram message sending
 */
export async function telegram_confirm<T>(
  chatId: number,
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
  text: string,
  onConfirm: () => Promise<T> | T,
  onCancel: () => Promise<T> | T,
  noSendTelegram = false,
): Promise<T> {
  const id = Date.now().toString();
  const confirmAction = `confirm_${id}`;
  const cancelAction = `cancel_${id}`;

  if (!noSendTelegram) {
    await sendTelegramMessage(
      chatId,
      text,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Yes", callback_data: confirmAction },
              { text: "No", callback_data: cancelAction },
            ],
          ],
        },
      },
      undefined,
      chatConfig,
    );
  }

  return new Promise<T>((resolve) => {
    useBot(chatConfig.bot_token!).action(
      confirmAction,
      async (ctx: Context) => {
        if (ctx.from?.id !== msg.from?.id) return;
        await ctx.answerCbQuery();
        const res = await onConfirm();
        resolve(res);
      },
    );

    useBot(chatConfig.bot_token!).action(cancelAction, async (ctx: Context) => {
      if (ctx.from?.id !== msg.from?.id) return;
      await ctx.answerCbQuery();
      if (!noSendTelegram) {
        await sendTelegramMessage(
          chatId,
          "Action canceled.",
          undefined,
          ctx,
          chatConfig,
        );
      }
      const res = await onCancel();
      resolve(res);
    });
  });
}

export default telegram_confirm;
