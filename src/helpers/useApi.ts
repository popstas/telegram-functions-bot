import OpenAI from 'openai'
import { HttpsProxyAgent } from "https-proxy-agent"
import { useConfig } from '../config'

let api: OpenAI | undefined

export function useApi(): OpenAI {
  if (!api) {
    const config = useConfig()
    const httpAgent = config.auth.proxy_url ? new HttpsProxyAgent(`${config.auth.proxy_url}`) : undefined

    api = new OpenAI({
      apiKey: config.auth.chatgpt_api_key,
      httpAgent,
    })
  }
  return api
}
