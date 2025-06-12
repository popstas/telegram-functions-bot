import OpenAI from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { useConfig } from "../config";

const apiCache: Record<string, OpenAI> = {};

export function useApi(modelName?: string): OpenAI {
  const cacheKey = modelName || "default";
  if (!apiCache[cacheKey]) {
    const config = useConfig();
    const httpAgent = config.auth.proxy_url
      ? new HttpsProxyAgent(`${config.auth.proxy_url}`)
      : undefined;

    if (modelName) {
      const model = config.models.find((m) => m.name === modelName);
      if (!model) throw new Error(`Local model ${modelName} not found`);
      apiCache[cacheKey] = new OpenAI({
        baseURL: `${model.url}/v1`,
        apiKey: config.auth.chatgpt_api_key,
        // httpAgent,
      });
    } else {
      apiCache[cacheKey] = new OpenAI({
        apiKey: config.auth.chatgpt_api_key,
        httpAgent,
      });
    }
  }
  return apiCache[cacheKey];
}
