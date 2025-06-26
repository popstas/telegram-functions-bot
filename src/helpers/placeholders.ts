export interface UrlCacheEntry {
  content: string;
  expiry: number;
}

const urlCache: Record<string, UrlCacheEntry> = {};

async function fetchUrl(url: string, cacheTime: number = 3600): Promise<string> {
  const cached = urlCache[url];
  if (cached && cached.expiry > Date.now()) {
    return cached.content;
  }
  const res = await fetch(url);
  const text = await res.text();
  urlCache[url] = { content: text, expiry: Date.now() + cacheTime * 1000 };
  return text;
}

export async function replaceUrlPlaceholders(text: string, cacheTime: number = 3600): Promise<string> {
  const regex = /\{url:([^}]+)}/g;
  const matches = [...text.matchAll(regex)];
  for (const match of matches) {
    const url = match[1];
    const content = await fetchUrl(url, cacheTime);
    text = text.replace(match[0], content);
  }
  return text;
}

// For tests
export function __clearUrlCache() {
  for (const key of Object.keys(urlCache)) {
    delete urlCache[key];
  }
}
