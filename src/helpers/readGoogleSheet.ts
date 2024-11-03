import {google} from "googleapis";
import {GoogleAuth, OAuth2Client} from 'google-auth-library';

export default async function readGoogleSheet(sheetId: string, auth: OAuth2Client | GoogleAuth): Promise<Object[]> {
  const sheets = google.sheets({version: 'v4', auth});
  const firstSheet = await sheets.spreadsheets.get({spreadsheetId: sheetId});
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: firstSheet.data.sheets?.[0].properties?.title || 'Sheet1',
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    return [];
  }

  const headers = rows[0];
  const data = rows.slice(1).map((row) => {
    const obj: { [key: string]: string } = {};
    row.forEach((value, index) => {
      obj[headers[index]] = value;
    });
    return obj;
  });

  return data;
}