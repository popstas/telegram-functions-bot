import {google} from "googleapis";
import {GoogleAuth, OAuth2Client} from 'google-auth-library';

export async function readGoogleSheet(sheetId: string, sheetName?: string | null, auth?: OAuth2Client | GoogleAuth): Promise<Object[]> {
  const sheets = google.sheets({version: 'v4', auth});
  const firstSheet = await sheets.spreadsheets.get({spreadsheetId: sheetId});
  const sheetNames = firstSheet.data.sheets?.map((sheet) => sheet.properties?.title);
  if (!sheetNames || sheetNames.length === 0) return [];
  if (!sheetName || !sheetNames.includes(sheetName)) {
    sheetName = sheetNames[0]
  }
  const sheetInd = sheetNames.indexOf(sheetName);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: firstSheet.data.sheets?.[sheetInd].properties?.title || sheetName || 'Sheet1',
  });

  const rows = response.data.values;
  if (!rows || rows.length === 0) {
    return [];
  }

  return rows;
}

export default async function readGoogleSheetToRows(sheetId: string, auth?: OAuth2Client | GoogleAuth): Promise<Object[]> {
  if (!auth) return [];
  const rows = await readGoogleSheet(sheetId, undefined, auth);

  const headers = rows[0];
  // @ts-ignore
  const data = rows.slice(1).map((row: any[]) => {
    const obj: { [key: string]: string } = {};
    row.forEach((value: any, index: number) => {
      // @ts-ignore
      obj[headers[index]] = value;
    });
    return obj;
  });

  return data;
}
