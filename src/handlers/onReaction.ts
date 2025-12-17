import { Context } from "telegraf";
import { Chat, Message, Update, User } from "telegraf/types";

type ReactionUpdate = NonNullable<Update.MessageReactionUpdate["message_reaction"]>;
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

function getReactionUser(update: Update.MessageReactionUpdate): User {
  const { user, actor_chat: actorChat } = update.message_reaction;
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

export default async function onReaction(ctx: Context) {
  const update = ctx.update as Update.MessageReactionUpdate;
  if (!update.message_reaction) return;

  const reactionText = buildReactionText(update.message_reaction.new_reaction || []);
  if (!reactionText) return;

  const reactionMessage: Message.TextMessage = {
    message_id: update.message_reaction.message_id,
    date: update.message_reaction.date,
    chat: update.message_reaction.chat as Chat,
    from: getReactionUser(update),
    text: reactionText,
    entities: [],
  } as Message.TextMessage;

  const reactionCtx = createNewContext(ctx, reactionMessage);

  const access = await checkAccessLevel(reactionCtx);
  if (!access) return;
  if (access.chat.chatParams?.answerReactions === false) return;

  await onTextMessage(reactionCtx);
}
