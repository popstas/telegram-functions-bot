import {
  aiFunction,
  AIFunctionsProvider,
} from '@agentic/core'
import {z} from 'zod'
import {readConfig} from '../config.ts'
import {ConfigChatType, ConfigType, ToolResponse} from "../types.ts";
import {exec} from "child_process";
import { writeFileSync, unlinkSync } from 'fs';
import * as tmp from 'tmp';

type ToolArgsType = {
  command: string
}

let client: SshCommandClient | undefined

export const description = 'SSH config.ssh.user shell, host from config.ssh.host'
export const details = `- convert question to command
- exec ssh from your machine, with your user ssh access
- answer with command output
- user: config.ssh.user
- host: config.ssh.host`

export class SshCommandClient extends AIFunctionsProvider {
  protected readonly config: ConfigType
  protected readonly configChat: ConfigChatType

  constructor(configChat: ConfigChatType) {
    super()

    this.config = readConfig();
    this.configChat = configChat
  }

  @aiFunction({
    name: 'ssh_command',
    description,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          'Shell command'
        ),
    })
  })

  async sshCommand(options: ToolArgsType) {
    const cmd = options.command;

    console.log('cmd:', cmd);

    const host = this.configChat.options?.ssh?.host || 'localhost'
    const user = this.configChat.options?.ssh?.user || 'root'

    const tempFile = tmp.fileSync({ mode: 0o755, prefix: 'ssh_command-', postfix: '.sh' });
    writeFileSync(tempFile.name, cmd);

    const scpCmd = `scp ${tempFile.name} ${user}@${host}:/tmp/${tempFile.name}`;
    const sshCmd = `ssh ${user}@${host} "bash /tmp/${tempFile.name}"`;

    const args = {command: cmd};
    const res = await new Promise((resolve, reject) => {
      exec(scpCmd, (scpError) => {
        if (scpError) {
          console.error(`scp error: ${scpError.message}`);
          reject(scpError.message);
        } else {
          exec(sshCmd, (sshError, stdout, stderr) => {
            tempFile.removeCallback();
            if (sshError) {
              console.error(`ssh error: ${sshError.message}`);
              if (sshError.code) {
                resolve({content: `Exit code: ${sshError.code}`, args});
              } else {
                reject(sshError.message);
              }
            }
            if (stderr) {
              console.error(`stderr: ${stderr}`);
              reject(stderr);
            }
            if (!stdout) {
              resolve({content: 'Exit code: 0', args});
              return
            } else {
              resolve({content: '```\n' + stdout + '\n```', args});
            }
          });
        }
      });
    });
    return res as ToolResponse
  }
}

export function call(configChat: ConfigChatType) {
  if (!client) client = new SshCommandClient(configChat);
  return client
}
