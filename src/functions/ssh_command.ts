import {
  aiFunction,
  AIFunctionsProvider,
} from '@agentic/core'
import {z} from 'zod'
import {readConfig} from '../config.ts'
import {ConfigChatType, ConfigType, ThreadStateType, ToolResponse} from "../types.ts";
import {exec} from "child_process";
import {writeFileSync} from 'fs';
import * as path from 'path';
// @ts-ignore
import * as tmp from 'tmp';

type ToolArgsType = {
  command: string
}

let client: SshCommandClient

export const description = 'SSH config.ssh_command.user shell, host from config.ssh_command.host, can run multiline scripts as command'
export const details = `- convert question to command
- exec ssh from your machine, with your user ssh access
- answer with command output
- user: config.ssh_command.user
- host: config.ssh_command.host`

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

    const host = this.configChat.toolParams?.ssh_command?.host || 'localhost'
    const user = this.configChat.toolParams?.ssh_command?.user || 'root'

    const tempFile = tmp.fileSync({mode: 0o755, prefix: 'ssh_command-', postfix: '.sh'});
    writeFileSync(tempFile.name, cmd);

    const destFilename = path.basename(tempFile.name);
    const scpCmd = `scp ${tempFile.name} ${user}@${host}:/tmp/${destFilename}`;
    const sshCmd = `ssh ${user}@${host} "bash /tmp/${destFilename}"`;

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
                resolve({
                  content: `Exit code: ${sshError.code}` + '\n```\n' + `${stdout}\n${sshError.message}` + '\n```',
                  args
                });
              } else {
                reject(sshError.message);
              }
              return
            }
            if (stderr) {
              resolve({content: '```\n' + `${stdout}\n${stderr}` + '\n```', args});
              // console.error(`stderr: ${stderr}`);
              // reject(stderr);
              return
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

export function call(configChat: ConfigChatType, thread: ThreadStateType, answerFunc: Function) {
  if (!client) client = new SshCommandClient(configChat);
  return client
}
