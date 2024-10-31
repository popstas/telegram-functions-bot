import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { aiFunction, AIFunctionsProvider } from '@agentic/core';
import { z } from 'zod';
import { ConfigType, ToolResponse } from '../types';
import { readConfig } from '../config';

type ToolArgsType = {
  sheetId: string;
};

let client: GoogleSheetClient | undefined;

export const description = 'Reads the first sheet of a Google Sheet using Google API and returns an array of objects with fields named by the table header.';
export const details = '';

export class GoogleSheetClient extends AIFunctionsProvider {
  protected readonly config: ConfigType;
  private oauth2Client: OAuth2Client;

  constructor() {
    super();
    this.config = readConfig();
    this.oauth2Client = new google.auth.OAuth2(
      this.config.auth.client_id,
      this.config.auth.client_secret,
      this.config.auth.redirect_uris[0]
    );
  }

  @aiFunction({
    name: 'read_google_sheet',
    description,
    inputSchema: z.object({
      sheetId: z.string().describe('Google Sheet ID'),
    }),
  })
  async read_google_sheet({ sheetId }: ToolArgsType): Promise<ToolResponse> {
    const sheets = google.sheets({ version: 'v4', auth: this.oauth2Client });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Sheet1',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      return { content: 'No data found.' };
    }

    const headers = rows[0];
    const data = rows.slice(1).map((row) => {
      const obj: { [key: string]: string } = {};
      row.forEach((value, index) => {
        obj[headers[index]] = value;
      });
      return obj;
    });

    return { content: JSON.stringify(data) };
  }
}

export function call() {
  if (!client) client = new GoogleSheetClient();
  return client;
}
