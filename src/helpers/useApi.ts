import OpenAI, { ClientOptions } from "openai";
import { HttpsProxyAgent } from "https-proxy-agent";
import { useConfig } from "../config";

const apiCache: Record<string, OpenAI> = {};

export function useApi(localModel?: string): OpenAI {
  const cacheKey = localModel || "default";
  if (!apiCache[cacheKey]) {
    const config = useConfig();
    const httpAgent = config.auth.proxy_url
      ? new HttpsProxyAgent(`${config.auth.proxy_url}`)
      : undefined;

    if (localModel) {
      const model = config.local_models.find((m) => m.name === localModel);
      if (!model) throw new Error(`Local model ${localModel} not found`);
      apiCache[cacheKey] = new OpenAI({
        baseURL: `${model.url}/v1`,
        apiKey: config.auth.chatgpt_api_key,
        // httpAgent,
      });
    } else {
      apiCache[cacheKey] = new OpenAI({
        apiKey: config.auth.chatgpt_api_key,
        httpAgent,
      } as unknown as ClientOptions & { httpAgent: unknown });
    }
  }
  return apiCache[cacheKey];
}
