import {GoogleAuth, OAuth2Client} from 'google-auth-library';
import {aiFunction, AIFunctionsProvider} from '@agentic/core';
import {z} from 'zod';
import {ConfigChatType, ConfigType, ThreadStateType, ToolResponse} from '../types';
import {readConfig} from '../config';
import readGoogleSheet from "../helpers/readGoogleSheet.ts";

type ToolArgsType = {
  sheetId: string;
};

export const description = 'Reads the first sheet of a Google Sheet using Google API and returns an array of objects with fields named by the table header.';
export const details = '';

export class GoogleSheetClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  private authClient?: OAuth2Client | GoogleAuth;

  constructor(authClient?: OAuth2Client | GoogleAuth) {
    super();
    this.config = readConfig();
    this.authClient = authClient;
  }

  @aiFunction({
    name: 'read_google_sheet',
    description,
    inputSchema: z.object({
      sheetId: z.string().describe('Google Sheet ID'),
    }),
  })
  async read_google_sheet({sheetId}: ToolArgsType): Promise<ToolResponse> {
    const data = await readGoogleSheet(sheetId, this.authClient);
    // if (!this.authClient?.credentials?.access_token || !this.authClient?.jsonContent) {
    if (!data) {
      return {content: 'No access token, auth with /google_auth'};
    }

    return {content: '```json\n' + JSON.stringify(data) + '\n```'};
  }

  options_string(str: string) {
    const {sheetId} = JSON.parse(str) as ToolArgsType;
    if (!sheetId) return str
    return `Read Google sheet: https://docs.google.com/spreadsheets/d/${sheetId}`
  }
}

export function call(configChat: ConfigChatType, thread: ThreadStateType) {
  return new GoogleSheetClient(thread?.authClient);
}