import { Chat, Message, User } from "grammy/types";
import type { BotContext } from "../telegram/botContext.ts";
import type { MessageReactionUpdate } from "../telegram/updateTypes.ts";

type ReactionUpdate = NonNullable<MessageReactionUpdate["message_reaction"]>;
type ReactionType = ReactionUpdate["new_reaction"][number];
import onTextMessage from "./onTextMessage.ts";
import checkAccessLevel from "./access.ts";
import { createNewContext } from "../telegram/context.ts";

function formatReaction(reaction: ReactionType): string {
  if (reaction.type === "emoji") {
    return reaction.emoji;
  }

  if (reaction.type === "custom_emoji") {
    return `:${reaction.custom_emoji_id}:`;
  }

  return "";
}

function buildReactionText(reactions: ReactionType[]): string {
  const icons = reactions.map(formatReaction).filter(Boolean).join(" ");
  return icons ? `${icons} (reaction)` : "";
}

function getReactionUser(reaction: ReactionUpdate): User {
  const { user, actor_chat: actorChat } = reaction;
  if (user) return user as User;

  if (actorChat) {
    const title = "title" in actorChat ? actorChat.title : undefined;
    const username = "username" in actorChat ? actorChat.username : undefined;
    return {
      id: actorChat.id,
      is_bot: actorChat.type === "channel",
      first_name: title ?? "Anonymous",
      username,
    } as unknown as User;
  }

  return {
    id: 0,
    is_bot: false,
    first_name: "Unknown",
  } as User;
}

export default async function onReaction(ctx: BotContext) {
  const reaction = ctx.messageReaction;
  if (!reaction) return;

  const reactionText = buildReactionText(reaction.new_reaction || []);
  if (!reactionText) return;

  const reactionMessage: Message.TextMessage = {
    message_id: reaction.message_id,
    date: reaction.date,
    chat: reaction.chat as Chat,
    from: getReactionUser(reaction),
    text: reactionText,
    entities: [],
  } as Message.TextMessage;

  const reactionCtx = createNewContext(ctx, reactionMessage);

  const access = await checkAccessLevel(reactionCtx);
  if (!access) return;
  if (access.chat.chatParams?.answerReactions === false) return;

  await onTextMessage(reactionCtx);
}
