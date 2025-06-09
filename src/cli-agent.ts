// TODO: cli is doing cold start, it's too long, need lightweight cli that will call running agent
import { runAgent } from "./agent-runner.ts";

export const runCliAgent = (args: string[]) => {
  const [agentName, ...t] = args;
  if (!agentName) {
    console.error("Usage: npm run agent <agent_name> [message]");
    process.exit(1);
  }
  const text = t.join(" ") || "";
  runAgent(agentName, text, (msg) => console.log(msg))
    .then((ans) => console.log(ans))
    .catch((err) => {
      console.error("Error:", err.message);
      process.exit(1);
    });
};

import { fileURLToPath } from 'url';
import { resolve } from 'path';

// Check if this file is being run directly (not imported)
const isMain = (() => {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptPath = process.argv[1] ? resolve(process.cwd(), process.argv[1]) : '';
  return scriptPath === currentFilePath;
})();

if (isMain) {
  runCliAgent(process.argv.slice(2));
}

