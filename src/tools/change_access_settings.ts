import { aiFunction, AIFunctionsProvider } from "@agentic/core";
import { z } from "zod";
import { readConfig, writeConfig } from "../config.ts";
import { ConfigType, ToolResponse } from "../types.ts";

type ToolArgsType = {
  addAdmin?: string[];
  removeAdmin?: string[];
  addPrivate?: string[];
  removePrivate?: string[];
};

export const description = "Update adminUsers and privateUsers in config.yml";
export const details = `- Add or remove usernames from adminUsers and privateUsers`;

export class ChangeAccessSettingsClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  protected readonly details: string;

  constructor() {
    super();
    this.config = readConfig();
    this.details = details;
  }

  @aiFunction({
    name: "change_access_settings",
    description,
    inputSchema: z.object({
      addAdmin: z
        .array(z.string())
        .optional()
        .describe("Usernames to add to adminUsers"),
      removeAdmin: z
        .array(z.string())
        .optional()
        .describe("Usernames to remove from adminUsers"),
      addPrivate: z
        .array(z.string())
        .optional()
        .describe("Usernames to add to privateUsers"),
      removePrivate: z
        .array(z.string())
        .optional()
        .describe("Usernames to remove from privateUsers"),
    }),
  })
  async change_access_settings(options: ToolArgsType) {
    const config = readConfig();
    const admins = new Set(config.adminUsers || []);
    const privates = new Set(config.privateUsers || []);

    options.addAdmin?.forEach((u) => admins.add(u));
    options.removeAdmin?.forEach((u) => admins.delete(u));
    options.addPrivate?.forEach((u) => privates.add(u));
    options.removePrivate?.forEach((u) => privates.delete(u));

    config.adminUsers = Array.from(admins);
    config.privateUsers = Array.from(privates);

    writeConfig("config.yml", config);

    return { content: "Access settings updated successfully" } as ToolResponse;
  }

  options_string(str: string) {
    const opts = JSON.parse(str) as ToolArgsType;
    if (!opts) return str;
    const parts: string[] = [];
    if (opts.addAdmin?.length)
      parts.push(`addAdmin: ${opts.addAdmin.join(", ")}`);
    if (opts.removeAdmin?.length)
      parts.push(`removeAdmin: ${opts.removeAdmin.join(", ")}`);
    if (opts.addPrivate?.length)
      parts.push(`addPrivate: ${opts.addPrivate.join(", ")}`);
    if (opts.removePrivate?.length)
      parts.push(`removePrivate: ${opts.removePrivate.join(", ")}`);
    if (!parts.length) return str;
    return `**Change access:** \`${parts.join("; ")}\``;
  }
}

export function call() {
  return new ChangeAccessSettingsClient();
}
