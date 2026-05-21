import { Context } from "telegraf";
import type { Message } from "telegraf/types";
import { log } from "../helpers.ts";
import onTextMessage, { noteSecretaryHumanReply } from "./onTextMessage.ts";

// Telegram Business support. Telegraf 4.16.3 has no business typings, so these
// updates are handled by inspecting the raw `ctx.update`. A business_message is
// delivered to a bot connected to a Business account ("Chat automation"); the
// message lives in the customer's chat, while the connection identifies the
// business OWNER. We resolve the owner so onTextMessage can route to the owner's
// chat config, and tag the reply with business_connection_id so it is sent as the
// Business account.

export type BusinessCtx = Context & {
  businessConnectionId?: string;
  businessOwnerUsername?: string;
  secondTry?: boolean;
};

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

type BusinessConnectionUpdate = {
  business_connection?: {
    id: string;
    user?: { id?: number; username?: string };
    can_reply?: boolean;
    is_enabled?: boolean;
  };
};

export async function onBusinessConnection(ctx: Context) {
  const conn = (ctx.update as BusinessConnectionUpdate).business_connection;
  if (!conn?.id) return;
  businessConnections.set(conn.id, {
    ownerId: conn.user?.id,
    ownerUsername: conn.user?.username,
    canReply: Boolean(conn.can_reply) && conn.is_enabled !== false,
  });
  log({
    msg: `business connection ${conn.id} owner @${conn.user?.username} can_reply=${conn.can_reply} enabled=${conn.is_enabled}`,
  });
}

async function resolveBusinessConnection(
  connectionId: string,
  telegram: Context["telegram"],
): Promise<BusinessConnectionInfo | undefined> {
  const cached = businessConnections.get(connectionId);
  if (cached) return cached;
  try {
    const conn = (await (
      telegram as unknown as { callApi: (m: string, p: object) => Promise<unknown> }
    ).callApi("getBusinessConnection", { business_connection_id: connectionId })) as {
      user?: { id?: number; username?: string };
      can_reply?: boolean;
      is_enabled?: boolean;
    };
    const info: BusinessConnectionInfo = {
      ownerId: conn?.user?.id,
      ownerUsername: conn?.user?.username,
      canReply: Boolean(conn?.can_reply) && conn?.is_enabled !== false,
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

type BusinessMessageUpdate = {
  business_message?: Message.TextMessage & { business_connection_id?: string };
};

export async function onBusinessMessage(ctx: Context) {
  const bm = (ctx.update as BusinessMessageUpdate).business_message;
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

  const info = await resolveBusinessConnection(connectionId, ctx.telegram);
  if (!info?.ownerUsername || !info.canReply) {
    log({
      msg: `business message: cannot route (owner=${info?.ownerUsername}, canReply=${info?.canReply}, conn=${connectionId})`,
      logLevel: "warn",
    });
    return;
  }

  // Messages the bot itself sent on behalf of the business carry sender_business_bot.
  // Ignore them so our own replies never look like a manual owner takeover.
  if ((bm as { sender_business_bot?: unknown }).sender_business_bot) {
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
  // `message` is a getter on the telegraf Context prototype (derived from
  // update.message), so it cannot be assigned — define it (and update) as own data
  // properties via descriptors. getCtxChatMsg then reads update.message unchanged;
  // routing to the owner config happens via businessOwnerUsername in getChatConfig.
  // persistentChatAction is stubbed because a bare sendChatAction has no
  // business_connection_id and would target the wrong surface.
  const own = { writable: true, configurable: true };
  const syntheticCtx = Object.create(Object.getPrototypeOf(ctx), {
    ...Object.getOwnPropertyDescriptors(ctx),
    message: { value: bm, ...own },
    update: { value: { ...ctx.update, message: bm }, ...own },
    persistentChatAction: {
      value: async (_action: string, cb: () => Promise<void>) => {
        await cb();
      },
      ...own,
    },
    businessConnectionId: { value: connectionId, ...own },
    businessOwnerUsername: { value: info.ownerUsername, ...own },
  }) as BusinessCtx;

  await onTextMessage(syntheticCtx);
}

export default onBusinessMessage;
