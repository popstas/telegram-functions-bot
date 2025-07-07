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
  
  return msgs;
}

export function prettyText(text: string) {
  const paragraphs = [];
  const sentences = text.split(/[.?!][ \n]/g);
  // console.log("sentences:", sentences.length);
  let paragraph = '';
  while (sentences.length > 0) {
    paragraph += sentences.shift() + '. ';
    paragraph = paragraph.replace(/\.\. $/, '. '); // remove ..

    if (paragraph.length > 200) {
      paragraphs.push(paragraph.trim() + '');
      // console.log("zero paragraph:", paragraph);
      paragraph = '';
    }
  }
  if (paragraph.length > 0) {
    paragraphs.push(paragraph.trim() + '');
  }
  // console.log("paragraphs", paragraphs);

  const prettyText = paragraphs.join('\n\n');
  return prettyText;
}
