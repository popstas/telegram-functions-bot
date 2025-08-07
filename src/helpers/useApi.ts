import OpenAI from "openai";
import { ProxyAgent } from "undici";
import { useConfig } from "../config.ts";

const apiCache: Record<string, OpenAI> = {};

export function useApi(localModel?: string): OpenAI {
  const cacheKey = localModel || "default";
  if (!apiCache[cacheKey]) {
    const config = useConfig();
    const proxyAgent = config.auth.proxy_url ? new ProxyAgent(config.auth.proxy_url) : undefined;

    if (localModel) {
      const model = config.local_models.find((m) => m.name === localModel);
      if (!model) throw new Error(`Local model ${localModel} not found`);
      apiCache[cacheKey] = new OpenAI({
        baseURL: `${model.url}/v1`,
        apiKey: config.auth.chatgpt_api_key,
        // don't use proxyAgent for local models
      });
    } else {
      apiCache[cacheKey] = new OpenAI({
        apiKey: config.auth.chatgpt_api_key,
        ...(proxyAgent ? { fetchOptions: { dispatcher: proxyAgent } } : {}),
      });
    }
  }
  return apiCache[cacheKey];
}
