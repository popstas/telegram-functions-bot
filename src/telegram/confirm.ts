import { Telegraf, Context } from "telegraf";
import { Message } from "telegraf/types";
import { sendTelegramMessage } from "./send.ts";
import { ConfigChatType } from "../types.ts";

let nextConfirmId = 1;

type PendingConfirmation = {
  fromId?: number;
  onConfirm: () => unknown;
  onCancel: () => unknown;
  resolve: (res: unknown) => void;
};

const pendingConfirmations = new Map<number, PendingConfirmation>();

/**
 * Static handler for confirm_<id>/cancel_<id> buttons. Registered ONCE per bot at
 * startup (launchBot) instead of two dynamic bot.action() per confirmation.
 */
export function registerConfirmActions(bot: Telegraf): void {
  bot.action(/^(confirm|cancel)_(\d+)$/, async (ctx: Context & { match: RegExpExecArray }) => {
    const kind = ctx.match[1] as "confirm" | "cancel";
    const id = parseInt(ctx.match[2], 10);
    const pending = pendingConfirmations.get(id);
    if (!pending) {
      await ctx.answerCbQuery("Expired");
      return;
    }
    // Same guard as before: only the user the confirmation was sent for may answer.
    if (ctx.from?.id !== pending.fromId) return;
    await ctx.answerCbQuery();
    pendingConfirmations.delete(id);
    const res = kind === "confirm" ? await pending.onConfirm() : await pending.onCancel();
    pending.resolve(res);
  });
}

/**
 * Send confirmation request with inline buttons and resolve based on user choice.
 *
 * @param params.chatId chat identifier
 * @param params.msg original message for user context
 * @param params.chatConfig chat configuration
 * @param params.text confirmation text
 * @param params.onConfirm callback executed when user confirms
 * @param params.onCancel callback executed when user cancels
 * @param params.noSendTelegram optional flag to skip Telegram message sending
 */
export async function telegramConfirm<T>(params: {
  chatId: number;
  msg: Message.TextMessage;
  chatConfig: ConfigChatType;
  text: string;
  onConfirm: () => Promise<T> | T;
  onCancel: () => Promise<T> | T;
  noSendTelegram?: boolean;
}): Promise<T> {
  const { chatId, msg, chatConfig, text, onConfirm, onCancel, noSendTelegram = false } = params;
  const id = nextConfirmId++;

  if (!noSendTelegram) {
    await sendTelegramMessage(
      chatId,
      text,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Yes", callback_data: `confirm_${id}` },
              { text: "No", callback_data: `cancel_${id}` },
            ],
          ],
        },
      },
      undefined,
      chatConfig,
    );
  }

  return new Promise<T>((resolve) => {
    pendingConfirmations.set(id, {
      fromId: msg.from?.id,
      onConfirm,
      onCancel,
      resolve: resolve as (res: unknown) => void,
    });
  });
}

export const __testConfirm = {
  reset() {
    pendingConfirmations.clear();
    nextConfirmId = 1;
  },
};

export default telegramConfirm;
