import { convertChatConfig } from "./config.ts";
import { fileURLToPath } from "url";
import { resolve } from "path";

export const runConfigConvert = (args: string[]) => {
  const [mode] = args as Array<"split" | "merge">;
  if (mode !== "split" && mode !== "merge") {
    console.error("Usage: npm run config:convert <split|merge>");
    process.exit(1);
  }
  convertChatConfig(mode);
};

const isMain = (() => {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptPath = process.argv[1]
    ? resolve(process.cwd(), process.argv[1])
    : "";
  return scriptPath === currentFilePath;
})();

if (isMain) {
  runConfigConvert(process.argv.slice(2));
}
