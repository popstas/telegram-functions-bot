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

export const description = 'PowerShell config.powershell.user shell, host from config.powershell.host'
export const details = `- convert question to command
- exec PowerShell from your machine, with your user PowerShell access
- answer with command output
- user: config.powershell.user
- host: config.powershell.host`

export class PowershellCommandClient extends AIFunctionsProvider {
  protected readonly config: ConfigType

  constructor() {
    super()

    this.config = readConfig();
  }

  @aiFunction({
    name: 'powershell_command',
    description,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          'PowerShell command'
        ),
    })
  })

  async powershellCommand(options: ToolArgsType) {
    const cmd = options.command;

    console.log('cmd:', cmd);

    const host = this.config.functions.powershell.host;
    const user = this.config.functions.powershell.user;

    const cmdStr = `powershell -Command "${cmd}"`;
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
