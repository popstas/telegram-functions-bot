export function splitBigMessage(text: string) {
  const msgs: string[] = [];
  const sizeLimit = 4096;
  let msg = "";

  for (const line of text.split("\n")) {
    if (line.length >= sizeLimit) {
      // If we have accumulated some text, push it first
      if (msg) {
        msgs.push(msg);
        msg = "";
      }
      // Split the long line into chunks of sizeLimit
      for (let i = 0; i < line.length; i += sizeLimit) {
        const chunk = line.slice(i, i + sizeLimit);
        msgs.push(chunk);
      }
    } else if (msg.length + line.length + 1 > sizeLimit) {
      if (msg) msgs.push(msg);
      msg = line + "\n";
    } else {
      msg += line + "\n";
    }
  }

  // Handle any remaining text in the buffer
  if (msg) {
    // Remove trailing newline if present
    const trimmedMsg = msg.endsWith("\n") ? msg.slice(0, -1) : msg;
    if (trimmedMsg) msgs.push(trimmedMsg);
  }

  return adjustCodeBlockSplits(msgs, text);
}

function adjustCodeBlockSplits(messages: string[], originalText: string) {
  if (messages.length < 2) return messages;
  if (!originalText.trimStart().startsWith("```")) return messages;

  const result = [...messages];
  let inCodeBlock = false;

  for (let i = 0; i < result.length - 1; i++) {
    const lines = result[i].split("\n");

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        inCodeBlock = !inCodeBlock;
      }
    }

    if (inCodeBlock) {
      const movedLine = lines.pop() ?? "";
      const withoutLastLine = lines.join("\n");

      result[i] = (withoutLastLine ? `${withoutLastLine}\n` : "") + "```";

      const nextMessagePrefix = movedLine ? `${movedLine}\n` : "";
      result[i + 1] = "```\n" + nextMessagePrefix + result[i + 1];

      inCodeBlock = false;
    }
  }

  return result;
}

export function prettyText(text: string) {
  if (!text) return "";

  const paragraphs: string[] = [];
  const sentences = text.match(/[^.?!]+[.?!]?/g) || [];

  let paragraph = "";
  for (let sentence of sentences) {
    sentence = sentence.trim();
    if (!/[.?!]$/.test(sentence)) sentence += ".";

    paragraph += sentence + " ";
    paragraph = paragraph.replace(/\.\. $/, ". ");

    if (paragraph.length > 200) {
      paragraphs.push(paragraph.trim());
      paragraph = "";
    }
  }

  if (paragraph.trim()) {
    paragraphs.push(paragraph.trim());
  }

  return paragraphs.join("\n\n");
}
