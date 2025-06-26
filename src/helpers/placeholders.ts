export interface UrlCacheEntry {
  content: string;
  expiry: number;
}

const urlCache: Record<string, UrlCacheEntry> = {};

async function fetchUrl(
  url: string,
  cacheTime: number = 3600,
): Promise<string> {
  const cached = urlCache[url];
  if (cached && cached.expiry > Date.now()) {
    return cached.content;
  }
  const res = await fetch(url);
  const text = await res.text();
  urlCache[url] = { content: text, expiry: Date.now() + cacheTime * 1000 };
  return text;
}

export async function replaceUrlPlaceholders(
  text: string,
  cacheTime: number = 3600,
): Promise<string> {
  const regex = /\{url:([^}]+)}/g;
  const matches = [...text.matchAll(regex)];
  for (const match of matches) {
    const url = match[1];
    const content = await fetchUrl(url, cacheTime);
    text = text.replace(match[0], content);
  }
  return text;
}

export interface ToolCacheEntry {
  content: string;
  expiry: number;
}

const toolCache: Record<string, ToolCacheEntry> = {};

export async function replaceToolPlaceholders(
  text: string,
  chatTools: import("../types").ChatToolType[],
  chatConfig: import("../types").ConfigChatType,
  thread: import("../types").ThreadStateType,
  cacheTime = 0,
): Promise<string> {
  const regex = /\{tool:([^\(]+)\(([^\)]*)\)}/g;
  const matches = [...text.matchAll(regex)];
  for (const match of matches) {
    const [, toolName, argsStr] = match;
    const cacheKey = `${toolName}:${argsStr}`;
    let content: string | undefined;
    const cached = toolCache[cacheKey];
    if (cached && cached.expiry > Date.now()) {
      content = cached.content;
    } else {
      const chatTool = chatTools.find((t) => t.name === toolName);
      if (!chatTool) continue;
      const fn = chatTool.module
        .call(chatConfig, thread)
        .functions.get(toolName);
      let parsedArgs: unknown;
      if (!argsStr.trim()) {
        parsedArgs = {};
      } else {
        try {
          parsedArgs = JSON.parse(argsStr);
        } catch {
          parsedArgs = argsStr;
        }
      }
      const argString =
        typeof parsedArgs === "string"
          ? parsedArgs
          : JSON.stringify(parsedArgs);
      const res = await fn(argString);
      content = res.content;
      toolCache[cacheKey] = { content, expiry: Date.now() + cacheTime * 1000 };
    }
    if (content !== undefined) {
      try {
        // Only try to parse if content looks like JSON (starts with { or [)
        if (content.trim().match(/^[[{]/)) {
          const json = JSON.parse(content);
          if (Array.isArray(json) && json[0]?.text) {
            text = text.replace(match[0], json[0].text);
            continue;
          }
        }
      } catch {
        // If parsing fails, just use the content as is
      }
      text = text.replace(match[0], content);
    }
  }
  return text;
}

export function __clearToolCache() {
  for (const key of Object.keys(toolCache)) {
    delete toolCache[key];
  }
}

// For tests
export function __clearUrlCache() {
  for (const key of Object.keys(urlCache)) {
    delete urlCache[key];
  }
}
