import {
  aiFunction,
  AIFunctionsProvider,
} from '@agentic/core'
import {z} from 'zod'
import {readConfig} from '../config.ts'
import {ConfigChatType, ConfigType, ThreadStateType, ToolResponse} from "../types.ts";
import vm from 'vm';

type ToolArgsType = {
  command: string
}

let client: JavascriptInterpreterClient | undefined

export const description = 'Useful for running JavaScript code in sandbox. Input is a string of JavaScript code, output is the result of the code.'
export const details = ``

export class JavascriptInterpreterClient extends AIFunctionsProvider {
  protected readonly config: ConfigType
  public readonly answerFunc: Function;

  constructor(answerFunc: Function) {
    super()
    this.config = readConfig();
    this.answerFunc = answerFunc;
  }

  @aiFunction({
    name: 'javascript_interpreter',
    description,
    inputSchema: z.object({
      command: z
        .string()
        .describe(
          'Javascript code'
        ),
    })
  })
  async javascript_interpreter(options: ToolArgsType) {
    const code = options.command;

    console.log('code:', code);

    void this.answerFunc(`\`\`\`javascript\n${code}\n\`\`\``);

    // Create a new context for the script to run in
    const context = vm.createContext({});
    const script = new vm.Script(code);

    let result;
    try {
      // Run the script in the context
      result = script.runInContext(context);
    } catch (error) {
      // @ts-ignore
      result = `Error: ${error.message}`;
    }

    return {content: `${result}`} as ToolResponse;
  }

  // version with exec
  /*async javascript_interpreter(options: ToolArgsType) {
    const code = options.command;

    console.log('code:', code);

    const tempFile = tmp.fileSync({mode: 0o755, prefix: 'javacript_interpreter-', postfix: '.js'});
    writeFileSync(tempFile.name, code);
    const cmdStr = `node -e "console.log(require('${tempFile.name}'))"`;
    const args = {command: options.command};
    const res = await new Promise((resolve, reject) => {
      exec(cmdStr, (error, stdout, stderr) => {
        tempFile.removeCallback();
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
  }*/
}

export function call(configChat: ConfigChatType, thread: ThreadStateType, answerFunc: Function) {
  if (!client) client = new JavascriptInterpreterClient(answerFunc);
  return client
}
