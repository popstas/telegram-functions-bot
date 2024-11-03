import OpenAI from "openai";
import {ChatToolType, ConfigChatType, ToolResponse} from "../types.ts";
import {bot, config} from "../index.ts";
import {getEncoding, TiktokenEncoding} from "js-tiktoken";
import {sendTelegramMessage} from "./telegram.ts";
import {Message} from "telegraf/types";

export async function buildMessages(systemMessage: string, history: OpenAI.ChatCompletionMessageParam[], chatTools: {
  name: string,
  module: any
}[]) {
  const limit = 7 // TODO: to config
  const messages: OpenAI.ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemMessage,
    },
  ];

  // limit history
  history = history.slice(-limit)

  // remove role: tool message from history if is first message
  if (history.length && history[0].role === 'tool') {
    history.shift()
  }

  messages.push(...history)

  // prompts from functions, should be after tools
  const prompts = await Promise.all(
    chatTools
      .filter(f => typeof f.module.prompt_append === 'function')
      .map(async f => await f.module.prompt_append())
      .filter(f => !!f)
  )
  if (prompts.length) {
    messages.push({role: 'system', content: prompts.join('\n\n')})
  }

  return messages
}

export function defaultSystemMessage() {
  return `You answer as concisely as possible for each response. If you are generating a list, do not have too many items.
Current date: ${new Date().toISOString()}\n\n`
}

export function getSystemMessage(chatConfig: ConfigChatType) {
  return chatConfig.systemMessage || config.systemMessage || defaultSystemMessage()
}

export function getTokensCount(text: string) {
  const encoding: TiktokenEncoding = config.completionParams.model.includes('4o') ? 'o200k_base' : 'cl100k_base';
  const tokenizer = getEncoding(encoding);
  return tokenizer.encode(text).length
}

// join "arguments.command" values with \n when same name, return array unique by name
export function groupToolCalls(toolCalls: OpenAI.ChatCompletionMessageToolCall[]) {
  const grouped = {} as { [key: string]: OpenAI.ChatCompletionMessageToolCall[] };
  toolCalls.forEach((toolCall) => {
    const name = toolCall.function.name;
    if (!grouped[name]) {
      grouped[name] = [];
    }
    grouped[name].push(toolCall);
  });

  return Object.values(grouped).map((group) => {
    if (group.length === 1) {
      return group[0];
    }
    const combinedCommand = group.map((call) => JSON.parse(call.function.arguments).command).join('\n');
    return {
      ...group[0],
      function: {...group[0].function, arguments: JSON.stringify({command: combinedCommand})} // TODO: remove hardcoded command
    };
  });
}

export async function callTools(toolCalls: OpenAI.ChatCompletionMessageToolCall[], chatTools: ChatToolType[], chatConfig: ConfigChatType, msg: Message.TextMessage) {
  toolCalls = groupToolCalls(toolCalls)
  const toolPromises = toolCalls.map(async (toolCall) => {
    const chatTool = chatTools.find(f => f.name === toolCall.function.name)
    if (!chatTool) return;

    const tool = chatTool.module.call(chatConfig).functions.get(toolCall.function.name)
    if (!tool) return
    let toolParams = toolCall.function.arguments

    // Check for 'confirm' or 'noconfirm' in the message to set confirmation
    if (msg.text.includes('noconfirm')) {
      chatConfig.confirmation = false;
    } else if (msg.text.includes('confirm')) {
      chatConfig.confirmation = true;
    }

    const params = JSON.parse(toolParams) // as ToolResponse
    if (toolParams && !chatConfig.confirmation && !chatTool.module.call().answerFunc) {
      // send message with tool call params
      void await sendTelegramMessage(msg.chat.id, '`' + toolCall.function.name + '()`:\n```\n' + toolParams + '\n```', {
        parse_mode: 'MarkdownV2',
        deleteAfter: chatConfig.deleteToolAnswers
      });
    }

    if (!chatConfig.confirmation) {
      // Execute the tool without confirmation
      return await tool(toolParams) as ToolResponse
    }

    return new Promise(async (resolve) => {
      // Send confirmation message with Yes/No buttons
      const uniqueId = Date.now().toString();
      await sendTelegramMessage(msg.chat.id, '`' + toolCall.function.name + '()`:\n```\n' + params.command + '\n```\nDo you want to proceed?', {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [
              {text: 'Yes', callback_data: `confirm_tool_${uniqueId}`},
              {text: 'No', callback_data: `cancel_tool_${uniqueId}`}
            ]
          ]
        }
      });

      // Handle the callback query
      bot.action(`confirm_tool_${uniqueId}`, async () => {
        const res = await tool(toolParams); // Execute the tool
        resolve(res);
        return;
      });
      bot.action(`cancel_tool_${uniqueId}`, async () => {
        await sendTelegramMessage(msg.chat.id, 'Tool execution canceled.');
        resolve({content: 'Tool execution canceled.'});
        return;
      });
    });
  })
  return Promise.all(toolPromises) as Promise<ToolResponse[]>
}
