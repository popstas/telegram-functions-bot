import { Context, Markup } from "telegraf";
import { Message, Chat } from "telegraf/types";
import OpenAI from "openai";
import {
  ConfigChatType,
  FormConfigType,
  FormFieldType,
  FormStateType,
  ThreadStateType,
} from "../types.ts";
import { sendTelegramMessage } from "../telegram/send.ts";
import { useConfig } from "../config.ts";
import { log } from "../helpers.ts";
import { llmCall } from "../helpers/gpt/llm.ts";

/**
 * Main entry point for form flow handling.
 * Returns a message if the form was handled, undefined to continue normal processing.
 */
export async function handleFormFlow(
  ctx: Context,
  msg: Message.TextMessage,
  chat: ConfigChatType,
  thread: ThreadStateType,
  extraParams: Record<string, unknown>,
): Promise<Message.TextMessage | undefined> {
  const forms = chat.chatParams?.form;
  if (!forms || forms.length === 0) {
    return undefined;
  }

  // Initialize or get form state
  if (!thread.formState) {
    // Start the first form
    return await startForm(ctx, msg, chat, thread, forms[0], 0, extraParams);
  }

  // Process message in active form
  return await processFormMessage(ctx, msg, chat, thread, extraParams);
}

/**
 * Start a new form flow
 */
async function startForm(
  ctx: Context,
  msg: Message.TextMessage,
  chat: ConfigChatType,
  thread: ThreadStateType,
  form: FormConfigType,
  formIndex: number,
  extraParams: Record<string, unknown>,
): Promise<Message.TextMessage | undefined> {
  // Initialize form state
  thread.formState = {
    active: true,
    formIndex,
    collectedData: {},
  };

  const chatTitle = (msg.chat as Chat.TitleChat).title || "";
  log({
    msg: `Form started: ${form.intro.slice(0, 50)}...`,
    chatId: msg.chat.id,
    chatTitle,
    role: "system",
    logLevel: "info",
  });

  // Send intro message with inline buttons for button fields
  const buttons = buildFormButtons(form, thread.formState);
  const introParams = buttons ? { ...extraParams, ...buttons } : extraParams;

  return await sendTelegramMessage(msg.chat.id, form.intro, introParams, ctx, chat);
}

/**
 * Process a message in an active form flow
 */
async function processFormMessage(
  ctx: Context,
  msg: Message.TextMessage,
  chat: ConfigChatType,
  thread: ThreadStateType,
  extraParams: Record<string, unknown>,
): Promise<Message.TextMessage | undefined> {
  const formState = thread.formState;
  if (!formState?.active) {
    return undefined;
  }

  const forms = chat.chatParams?.form;
  if (!forms) {
    return undefined;
  }

  const form = forms[formState.formIndex];
  if (!form) {
    thread.formState = undefined;
    return undefined;
  }

  const userText = msg.text || "";
  const chatTitle = (msg.chat as Chat.TitleChat).title || "";

  // Get unfilled fields
  const unfilledFields = getUnfilledFields(form, formState);

  if (unfilledFields.length === 0) {
    // All fields filled, complete the form
    return await completeForm(ctx, msg, chat, thread, form, extraParams);
  }

  // Try to extract data from user text using LLM
  const extractedData = await extractFormData(userText, unfilledFields, msg, chat);

  if (extractedData && Object.keys(extractedData).length > 0) {
    // Update collected data
    Object.assign(formState.collectedData, extractedData);
    log({
      msg: `Form data extracted: ${JSON.stringify(extractedData)}`,
      chatId: msg.chat.id,
      chatTitle,
      role: "system",
      logLevel: "info",
    });
  }

  // Check again if all fields are now filled
  const stillUnfilled = getUnfilledFields(form, formState);

  if (stillUnfilled.length === 0) {
    // All fields filled, complete the form
    return await completeForm(ctx, msg, chat, thread, form, extraParams);
  }

  // Build status message showing what's been collected and what's still needed
  const statusMessage = buildStatusMessage(form, formState, stillUnfilled);

  // Send status with buttons for remaining button fields
  const buttons = buildFormButtons(form, formState);
  const statusParams = buttons ? { ...extraParams, ...buttons } : extraParams;

  return await sendTelegramMessage(msg.chat.id, statusMessage, statusParams, ctx, chat);
}

/**
 * Handle inline button click for form
 * @param fieldIndex - index of the field in form.items
 * @param optionIndex - index of the option in field.options
 */
export async function handleFormButtonClick(
  ctx: Context,
  fieldIndex: number,
  optionIndex: number,
): Promise<void> {
  const callbackQuery = ctx.callbackQuery;
  if (!callbackQuery || !("message" in callbackQuery)) {
    return;
  }

  const chatId = callbackQuery.message?.chat.id;
  if (!chatId) {
    return;
  }

  // Find the chat config
  const config = useConfig();
  const chat = config.chats.find((c) => c.id === chatId || c.ids?.includes(chatId));

  if (!chat?.chatParams?.form) {
    await ctx.answerCbQuery("Form not configured");
    return;
  }

  // Get thread state (we need to import useThreads)
  const { useThreads } = await import("../threads.ts");
  const threads = useThreads();
  const thread = threads[chatId];

  if (!thread?.formState?.active) {
    await ctx.answerCbQuery("No active form");
    return;
  }

  const formState = thread.formState;
  const form = chat.chatParams.form[formState.formIndex];

  if (!form) {
    await ctx.answerCbQuery("Form not found");
    return;
  }

  // Get field and option by index
  const field = form.items[fieldIndex];
  if (!field || field.type !== "button" || !field.options) {
    await ctx.answerCbQuery("Invalid field");
    return;
  }

  const option = field.options[optionIndex];
  if (!option) {
    await ctx.answerCbQuery("Invalid option");
    return;
  }

  const fieldName = field.name;
  const value = option.label;

  // Update collected data with button selection
  formState.collectedData[fieldName] = value;

  const chatTitle = (callbackQuery.message?.chat as Chat.TitleChat).title || "";
  log({
    msg: `Form button clicked: ${fieldName} = ${value}`,
    chatId,
    chatTitle,
    role: "system",
    logLevel: "info",
  });

  // Answer callback to remove loading state
  await ctx.answerCbQuery(`${fieldName}: ${value}`);

  // Check if form is complete
  const stillUnfilled = getUnfilledFields(form, formState);

  if (stillUnfilled.length === 0) {
    // Complete the form
    const virtualMsg = {
      chat: { id: chatId },
      message_id: callbackQuery.message?.message_id,
      from: callbackQuery.from,
      text: "",
      date: Math.floor(Date.now() / 1000),
    } as Message.TextMessage;

    await completeForm(ctx, virtualMsg, chat, thread, form, {});
    return;
  }

  // Update message with remaining fields
  const statusMessage = buildStatusMessage(form, formState, stillUnfilled);
  const buttons = buildFormButtons(form, formState);

  try {
    if (buttons) {
      await ctx.editMessageText(statusMessage, buttons);
    } else {
      await ctx.editMessageText(statusMessage);
    }
  } catch {
    // Message might not have changed, ignore error
  }
}

/**
 * Complete the form and send results
 */
async function completeForm(
  ctx: Context,
  msg: Message.TextMessage,
  chat: ConfigChatType,
  thread: ThreadStateType,
  form: FormConfigType,
  extraParams: Record<string, unknown>,
): Promise<Message.TextMessage | undefined> {
  const formState = thread.formState;
  if (!formState) {
    return undefined;
  }

  const chatTitle = (msg.chat as Chat.TitleChat).title || "";

  // Format the message using template
  const formattedMessage = formatTemplate(form.message_template, formState.collectedData);

  log({
    msg: `Form completed. Data: ${JSON.stringify(formState.collectedData)}`,
    chatId: msg.chat.id,
    chatTitle,
    role: "system",
    logLevel: "info",
  });

  // Send end message to user
  const endMessage = await sendTelegramMessage(msg.chat.id, form.end, extraParams, ctx, chat);

  // Send formatted message to recipients
  await sendToRecipients(form.send_to, formattedMessage, chat);

  // Reset form state
  thread.formState = undefined;

  return endMessage;
}

/**
 * Send formatted message to all recipients
 */
async function sendToRecipients(
  recipients: (string | number)[],
  message: string,
  chatConfig: ConfigChatType,
): Promise<void> {
  const config = useConfig();

  for (const recipient of recipients) {
    let chatId: number | undefined;

    if (typeof recipient === "number") {
      chatId = recipient;
    } else {
      // Try to find chat by username or name
      const recipientChat = config.chats.find(
        (c) => c.username === recipient || c.name === recipient,
      );
      chatId = recipientChat?.id;

      if (!chatId) {
        log({
          msg: `Form: Could not find chat for recipient: ${recipient}`,
          logLevel: "warn",
        });
        continue;
      }
    }

    try {
      await sendTelegramMessage(chatId, message, undefined, undefined, chatConfig);
      log({
        msg: `Form: Sent to recipient ${recipient} (${chatId})`,
        logLevel: "info",
      });
    } catch (error) {
      log({
        msg: `Form: Error sending to recipient ${recipient}: ${(error as Error).message}`,
        logLevel: "warn",
      });
    }
  }
}

/**
 * Extract form data from user text using LLM
 */
async function extractFormData(
  userText: string,
  unfilledFields: FormFieldType[],
  msg: Message.TextMessage,
  chatConfig: ConfigChatType,
): Promise<Record<string, string> | undefined> {
  // Only extract text fields - button fields are handled by button clicks
  const textFields = unfilledFields.filter((f) => f.type === "text");

  if (textFields.length === 0) {
    return undefined;
  }

  const config = useConfig();
  const agentConfig = config.chats?.find((c) => c.agent_name === "form-extractor");

  if (!agentConfig) {
    // Fallback: if only one text field, use the entire message as value
    if (textFields.length === 1) {
      return { [textFields[0].name]: userText };
    }
    log({
      msg: "Form: form-extractor agent not found, cannot extract multiple fields",
      logLevel: "warn",
    });
    return undefined;
  }

  // Build field descriptions for the agent
  const fieldsDescription = textFields
    .map((f) => `- ${f.name}${f.placeholder ? ` (${f.placeholder})` : ""}`)
    .join("\n");

  const userMessage = `Fields to extract:\n${fieldsDescription}\n\nUser message: ${userText}`;

  const apiParams: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    messages: [
      { role: "system", content: agentConfig.systemMessage || "" },
      { role: "user", content: userMessage },
    ],
    model: agentConfig.completionParams?.model || "gpt-4.1-nano",
    temperature: agentConfig.completionParams?.temperature,
    response_format: agentConfig.response_format,
  };

  try {
    const { res } = await llmCall({
      apiParams,
      chatConfig: agentConfig,
      generationName: "form-extractor",
      localModel: agentConfig.local_model,
      noSendTelegram: true,
      msg,
    });

    const content = res.choices?.[0]?.message?.content;
    if (!content) return undefined;

    const parsed = JSON.parse(content) as Record<string, string>;

    // Filter to only include valid field names
    const validFieldNames = new Set(textFields.map((f) => f.name));
    const filtered: Record<string, string> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (validFieldNames.has(key) && typeof value === "string" && value.trim()) {
        filtered[key] = value.trim();
      }
    }

    return Object.keys(filtered).length > 0 ? filtered : undefined;
  } catch (error) {
    log({
      msg: `Form: Error extracting data: ${(error as Error).message}`,
      logLevel: "warn",
      chatId: msg.chat.id,
    });
    return undefined;
  }
}

/**
 * Get list of unfilled fields
 */
function getUnfilledFields(form: FormConfigType, state: FormStateType): FormFieldType[] {
  return form.items.filter((field) => !state.collectedData[field.name]);
}

/**
 * Build inline keyboard for unfilled button fields
 * Uses field index and option index to keep callback_data under 64 bytes
 */
function buildFormButtons(
  form: FormConfigType,
  state: FormStateType,
): ReturnType<typeof Markup.inlineKeyboard> | undefined {
  const unfilledButtonFields = form.items
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => field.type === "button" && !state.collectedData[field.name]);

  if (unfilledButtonFields.length === 0) {
    return undefined;
  }

  const buttons: { text: string; callback_data: string }[][] = [];

  for (const { field, index: fieldIndex } of unfilledButtonFields) {
    if (!field.options) continue;

    // Add field name as a header row (non-clickable label)
    buttons.push([
      {
        text: `📝 ${field.name}:`,
        callback_data: `fl:${fieldIndex}`,
      },
    ]);

    // Add options for this field (2 per row for better layout)
    // Use short callback format: f:{fieldIndex}:{optionIndex}
    const optionButtons = field.options.map((opt, optIndex) => ({
      text: opt.label,
      callback_data: `f:${fieldIndex}:${optIndex}`,
    }));

    // Group options 2 per row
    for (let i = 0; i < optionButtons.length; i += 2) {
      buttons.push(optionButtons.slice(i, i + 2));
    }
  }

  return buttons.length > 0 ? Markup.inlineKeyboard(buttons) : undefined;
}

/**
 * Format template with collected data
 */
function formatTemplate(template: string, data: Record<string, string>): string {
  let result = template;

  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }

  // Replace any remaining unfilled placeholders with empty string
  result = result.replace(/\{[^}]+\}/g, "—");

  return result.trim();
}

/**
 * Build status message showing collected and missing fields
 */
function buildStatusMessage(
  form: FormConfigType,
  state: FormStateType,
  unfilled: FormFieldType[],
): string {
  const collected = Object.entries(state.collectedData)
    .map(([key, value]) => `✅ ${key}: ${value}`)
    .join("\n");

  const missing = unfilled
    .map((f) => {
      if (f.type === "button") {
        return `⏳ ${f.name}: выберите кнопкой`;
      }
      return `⏳ ${f.name}: ${f.placeholder || "введите значение"}`;
    })
    .join("\n");

  const parts: string[] = [];

  if (collected) {
    parts.push("Заполнено:\n" + collected);
  }

  if (missing) {
    parts.push("Осталось заполнить:\n" + missing);
  }

  return parts.join("\n\n");
}
