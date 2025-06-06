import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { readConfig } from "../config.ts";
import {
  ConfigChatType,
  ConfigType,
  SshConfigType,
  ToolResponse,
} from "../types.ts";
import { exec } from "child_process";
import { writeFileSync } from "fs";
import * as path from "path";
import * as tmp from "tmp";

type ToolArgsType = {
  command: string;
};

export const description =
  "Run commands via SSH, can run multiline scripts as command";
export const details = `- convert question to command
- exec ssh from your machine, with your user ssh access
- answer with command output
- user: toolParams.ssh_command.user
- host: toolParams.ssh_command.host`;

export const defaultParams = {
  ssh_command: {
    user: "root",
    host: "localhost",
  },
} as { ssh_command: SshConfigType };

export class SshCommandClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly configChat: ConfigChatType;
  protected readonly details: string;

  constructor(configChat: ConfigChatType) {
    super();
    this.config = readConfig();
    this.configChat = configChat;
    this.details = details;
  }

  @aiFunction({
    name: "ssh_command",
    description,
    inputSchema: z.object({
      command: z.string().describe("Shell command"),
    }),
  })
  async ssh_command(options: ToolArgsType) {
    const cmd = options.command;

    // console.log('cmd:', cmd);

    const { user, host, strictHostKeyChecking } = this.getUserHost();

    const tempFile = tmp.fileSync({
      mode: 0o755,
      prefix: "ssh_command-",
      postfix: ".sh",
    });
    writeFileSync(tempFile.name, cmd);

    const destFilename = path.basename(tempFile.name);
    const scpCmd = `scp -o StrictHostKeyChecking=${strictHostKeyChecking ? "yes" : "no"} ${tempFile.name} ${user}@${host}:/tmp/${destFilename}`;
    const sshCmd = `ssh -o StrictHostKeyChecking=${strictHostKeyChecking ? "yes" : "no"} ${user}@${host} "bash /tmp/${destFilename}"`;

    const res = await new Promise((resolve, reject) => {
      exec(scpCmd, (scpError) => {
        if (scpError) {
          console.error(`scp error: ${scpError.message}`);
          reject(scpError.message);
        } else {
          exec(sshCmd, (sshError, stdout, stderr) => {
            tempFile.removeCallback();
            if (sshError) {
              // console.error(`ssh error: ${sshError.message}`);
              if (sshError.code) {
                const errorMsg = sshError.message.replace(
                  /Command failed: ssh .* "bash .*?"/,
                  "",
                );
                const outPipe = (name: string, output: string) =>
                  output.trim() ? `${name}:\n\`\`\`${output}\n\`\`\`\n\n` : "";
                resolve({
                  content: `Exit code: ${sshError.code}\n\n${outPipe("stdout", stdout)}${outPipe("stderr", stderr)}${outPipe("error", errorMsg)}`,
                });
              } else {
                reject(sshError.message);
              }
              return;
            }
            if (stderr) {
              resolve({ content: "```\n" + `${stdout}\n${stderr}` + "\n```" });
              // console.error(`stderr: ${stderr}`);
              // reject(stderr);
              return;
            }
            if (!stdout) {
              resolve({ content: "Exit code: 0" });
              return;
            } else {
              resolve({ content: "```\n" + stdout + "\n```" });
            }
          });
        }
      });
    });
    return res as ToolResponse;
  }

  getUserHost() {
    const host = this.configChat.toolParams?.ssh_command?.host || "localhost";
    const user = this.configChat.toolParams?.ssh_command?.user || "root";
    const strictHostKeyChecking =
      this.configChat.toolParams?.ssh_command?.strictHostKeyChecking || false;
    return { user, host, strictHostKeyChecking };
  }

  options_string(str: string) {
    const { command } = JSON.parse(str) as ToolArgsType;
    if (!command) return str;
    const { user, host } = this.getUserHost();
    return `\`ssh ${user}@${host}\`\n\`\`\`sh\n${command}\n\`\`\``;
  }

  systemMessage() {
    const { user, host } = this.getUserHost();
    return [
      `You are using ssh commands on remote ssh server ${user}@${host}.`,
      `Don't use sudo.`,
      `Current date: {date}`,
    ].join("\n");
  }
}

export function call(configChat: ConfigChatType) {
  return new SshCommandClient(configChat);
}
