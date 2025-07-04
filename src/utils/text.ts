export function splitBigMessage(text: string) {
  const msgs: string[] = [];
  const sizeLimit = 4096;
  let msg = "";

  for (const line of text.split("\n")) {
    if (msg.length + line.length + 1 > sizeLimit) {
      if (msg) msgs.push(msg);
      msg = "";
    }
    msg += line + "\n";
  }
  if (msg.length > sizeLimit) {
    msg = msg.slice(0, sizeLimit - 3) + "...";
  }
  if (msg) msgs.push(msg);
  return msgs;
}
