export function splitBigMessage(text: string) {
  const msgs: string[] = [];
  const sizeLimit = 4096;
  let msg = "";

  for (const origLine of text.split("\n")) {
    const line = origLine.trim();
    if (!line) continue;
    if (msg.length + line.length + 1 > sizeLimit) {
      if (msg.trim()) msgs.push(msg);
      msg = "";
    }
    msg += line + "\n";
  }
  if (msg.length > sizeLimit) {
    msg = msg.slice(0, sizeLimit - 3) + "...";
  }
  if (msg.trim()) msgs.push(msg);
  return msgs;
}
