import {
  aiFunction,
  AIFunctionsProvider,
} from '@agentic/core'
import {z} from 'zod'
import {readConfig} from '../config.ts'
import {ConfigType, ToolResponse} from "../types.ts";
import {exec} from "child_process";

type ToolArgsType = {
  command: string
}

export const description = 'SSH config.ssh.user shell, host from config.ssh.host'
export const details = `- convert question to command
- exec ssh from your machine, with your user ssh access
- answer with command output
- user: config.ssh.user
- host: config.ssh.host`

export class SshCommandClient extends AIFunctionsProvider {
  protected readonly config: ConfigType

  constructor() {
    super()

    this.config = readConfig();
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

    const host = this.config.functions.ssh.host;
    const user = this.config.functions.ssh.user;

    const cmdArgs = [
      '-o "StrictHostKeyChecking no"',
      '-o "UserKnownHostsFile /dev/null"',
      '-o "LogLevel ERROR"',
      '-o "ConnectTimeout 10"',
      '-o "ServerAliveInterval 60"',
      '-o "ServerAliveCountMax 3"',
      '-o "BatchMode yes"',
      '-o "PasswordAuthentication no"',
      '-o "PreferredAuthentications publickey"',
      '-o "IdentityFile ~/.ssh/id_rsa"',
      `-o "User ${user}"`,
      host,
      `"${cmd}"`
    ];
    const cmdStr = `ssh ${cmdArgs.join(' ')}`;
    const args = {command: cmd};
    const res = await new Promise((resolve, reject) => {
      exec(cmdStr, (error, stdout, stderr) => {
        if (error) {
          console.error(`error: ${error.message}`);
          if (error.code) {
            resolve({content: `Exit code: ${error.code}`, args});
          } else {
            reject(error.message);
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
    });
    return res as ToolResponse
  }
}