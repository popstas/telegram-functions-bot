import {ChatToolType} from "../types.ts";
import {readdirSync} from "fs";
import {log} from "../helpers.ts";

let globalTools: ChatToolType[] = []

export default async function useTools(): Promise<ChatToolType[]> {
  if (!globalTools.length) await initTools();
  return globalTools;
}

export async function initTools() {
  globalTools = []
  const files = readdirSync('src/tools').filter(file => file.endsWith('.ts'))

  for (const file of files) {
    const name = file.replace('.ts', '')
    const module = await import(`../tools/${name}`)
    if (typeof module.call !== 'function') {
      log({msg: `Function ${name} has no call() method`, logLevel: 'warn'})
      continue
    }
    globalTools.push({name, module})
  }
  return globalTools
}
