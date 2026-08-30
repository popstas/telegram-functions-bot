import { Context } from "grammy";
import type { Api } from "grammy";
import type { Update } from "grammy/types";
import { log } from "../helpers.ts";
import type { BotContext } from "../telegram/botContext.ts";
import onTextMessage, { noteSecretaryHumanReply } from "./onTextMessage.ts";

// Telegram Business support. A business_message is delivered to a bot connected
// to a Business account ("Chat automation"); the message lives in the
// customer's chat, while the connection identifies the business OWNER. We
// resolve the owner so onTextMessage can route to the owner's chat config, and
// tag the reply with business_connection_id so it is sent as the Business
// account. grammY natively types business_message/business_connection
// (ctx.businessMessage/ctx.businessConnection) and derives
// ctx.businessConnectionId from the message, so no raw ctx.update casts are
// needed here.

interface BusinessConnectionInfo {
  ownerId?: number;
  ownerUsername?: string;
  canReply: boolean;
}

// connection id -> owner info. Populated by business_connection updates and lazily
// via getBusinessConnection when a message arrives before (or after a restart).
const businessConnections = new Map<string, BusinessConnectionInfo>();

export function __resetBusinessConnections() {
  businessConnections.clear();
}

export async function onBusinessConnection(ctx: Context) {
  const conn = ctx.businessConnection;
  if (!conn?.id) return;
  businessConnections.set(conn.id, {
    ownerId: conn.user?.id,
    ownerUsername: conn.user?.username,
    canReply: Boolean(conn.rights?.can_reply) && conn.is_enabled !== false,
  });
  log({
    msg: `business connection ${conn.id} owner @${conn.user?.username} can_reply=${conn.rights?.can_reply} enabled=${conn.is_enabled}`,
  });
}

async function resolveBusinessConnection(
  connectionId: string,
  api: Api,
): Promise<BusinessConnectionInfo | undefined> {
  const cached = businessConnections.get(connectionId);
  if (cached) return cached;
  try {
    const conn = await api.getBusinessConnection(connectionId);
    const info: BusinessConnectionInfo = {
      ownerId: conn?.user?.id,
      ownerUsername: conn?.user?.username,
      canReply: Boolean(conn?.rights?.can_reply) && conn?.is_enabled !== false,
    };
    businessConnections.set(connectionId, info);
    return info;
  } catch (e) {
    log({
      msg: `getBusinessConnection failed for ${connectionId}: ${(e as Error).message}`,
      logLevel: "warn",
    });
    return undefined;
  }
}

export async function onBusinessMessage(ctx: BotContext) {
  const bm = ctx.businessMessage;
  if (!bm) return;
  if (!bm.text) {
    // Text only for now; ignore business voice/photo/documents.
    return;
  }
  const connectionId = bm.business_connection_id;
  if (!connectionId) {
    log({ msg: "business message without business_connection_id, ignored", logLevel: "warn" });
    return;
  }

  const info = await resolveBusinessConnection(connectionId, ctx.api);
  if (!info?.ownerUsername || !info.canReply) {
    log({
      msg: `business message: cannot route (owner=${info?.ownerUsername}, canReply=${info?.canReply}, conn=${connectionId})`,
      logLevel: "warn",
    });
    return;
  }

  // Messages the bot itself sent on behalf of the business carry sender_business_bot.
  // Ignore them so our own replies never look like a manual owner takeover.
  if (bm.sender_business_bot) {
    log({ msg: "business: ignoring bot-sent message", logLevel: "debug" });
    return;
  }

  // A message authored by the connection owner (not the customer) means the owner is
  // handling this chat manually — pause secretary auto-answers for the session.
  const isOwner =
    (info.ownerId !== undefined && bm.from?.id === info.ownerId) ||
    (!!info.ownerUsername && bm.from?.username === info.ownerUsername);
  if (isOwner) {
    log({
      msg: `secretary: owner replied manually, pausing auto-answer (chat ${bm.chat?.id})`,
      chatId: bm.chat?.id,
      role: "system",
      username: bm.from?.username,
    });
    if (bm.chat?.id !== undefined) noteSecretaryHumanReply(bm.chat.id);
    return;
  }

  log({
    msg: `business message from @${bm.from?.username} (owner @${info.ownerUsername}, conn ${connectionId})`,
    chatId: bm.chat?.id,
    role: "user",
    username: bm.from?.username,
  });

  // Build a synthetic ctx that flows through the normal onTextMessage pipeline.
  // ctx.message/chat/from are getters over ctx.update (Task 6), so we build a
  // real Context around a substituted update, same trick as createNewContext.
  // We don't call createNewContext itself here: it copies BotFlavor keys from
  // the source ctx via attachFlavor, including businessConnectionId — but the
  // incoming ctx's businessConnectionId (native getter, derived from bm) is
  // already truthy here, and assigning to that getter on a real Context throws
  // (grammY defines it as a getter with no setter). Embedding bm as
  // update.message sidesteps this entirely: ctx.businessConnectionId is then
  // derived for free from the message, so it never needs to be assigned.
  // businessOwnerUsername has no native getter, so it is set directly; routing
  // to the owner config happens via businessOwnerUsername in getChatConfig.
  const update = { ...ctx.update, message: bm } as Update;
  const syntheticCtx = new Context(update, ctx.api, ctx.me) as BotContext;
  syntheticCtx.businessOwnerUsername = info.ownerUsername;

  await onTextMessage(syntheticCtx);
}

export default onBusinessMessage;
