import * as fs from 'fs';
import * as path from 'path';
import recursiveReaddir from 'recursive-readdir';
import { aiFunction } from '@agentic/core';
import { z } from 'zod';

@aiFunction({
  name: 'obsidian_write',
  description: 'Append text to a markdown file specified by out_file',
  inputSchema: z.object({
    out_file: z
      .string()
      .describe(
        'Path to the output markdown file'
      ),
    text: z
      .string()
      .describe(
        'Text to append to the markdown file'
      ),
  })
})
export function obsidian_write(out_file: string, text: string): void {
  fs.appendFileSync(out_file, text);
}

@aiFunction({
  name: 'obsidian_tree',
  description: 'Return the Obsidian project files tree',
  inputSchema: z.object({
    root_path: z
      .string()
      .describe(
        'Root path of the Obsidian project'
      ),
  })
})
export function obsidian_tree(root_path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    recursiveReaddir(root_path, (err, files) => {
      if (err) {
        reject(err);
      } else {
        resolve(files);
      }
    });
  });
}

@aiFunction({
  name: 'obsidian_read',
  description: 'Read the contents of an Obsidian file',
  inputSchema: z.object({
    file_path: z
      .string()
      .describe(
        'Path to file in Obsidian project'
      ),
  })
})
export function obsidian_read(file_path: string): string {
  return fs.readFileSync(file_path, 'utf8');
}
