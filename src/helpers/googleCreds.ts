import {google} from "googleapis";

const credsFilePath = 'data/creds.json';
import {Credentials} from "google-auth-library/build/src/auth/credentials";
import fs from "fs";
import {Context} from "telegraf";
import {readConfig} from "../config.ts";

export function getUserGoogleCreds(user_id?: number): Credentials | undefined {
  if (!user_id) return;
  const creds = loadGoogleCreds();
  return creds[user_id];
}

export function loadGoogleCreds() {
  let existingCreds: { [key: number]: Credentials } = {};
  if (fs.existsSync(credsFilePath)) {
    const credsData = fs.readFileSync(credsFilePath, 'utf-8');
    existingCreds = JSON.parse(credsData);
  }
  return existingCreds;
}

export function saveUserGoogleCreds(creds?: Credentials | null, user_id?: number) {
  if (!user_id) {
    console.error('No user_id to save creds')
    return;
  }
  if (!creds) {
    console.error('No creds to save')
    return;
  }
  // save to data/creds.json

  const existingCreds = loadGoogleCreds();

  // Add or replace the user's credentials
  // @ts-ignore
  existingCreds[user_id] = creds;

  // Save the updated credentials back to the file
  fs.writeFileSync(credsFilePath, JSON.stringify(existingCreds, null, 2), 'utf-8');
}

export async function ensureAuth(user_id: number, ctx: Context) {
  const creds = getUserGoogleCreds(user_id);
  const config = readConfig();

  // Check if the user has credentials
  if (creds && creds.expiry_date && creds.expiry_date > Date.now()) {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials(creds);

    // handling token refresh
    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        // store the refresh_token in my database!
        console.log(tokens.refresh_token);
      }
      console.log(tokens.access_token);
      void saveUserGoogleCreds(oauth2Client.credentials, user_id);
    });

    return oauth2Client;
  }

  // common service account
  if (config.auth.google_service_account?.private_key) {
    return new google.auth.GoogleAuth({
      credentials: config.auth.google_service_account,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
  }

  // get auth url oauth2Client
  return new google.auth.OAuth2(
    config.oauth_google.client_id,
    config.oauth_google.client_secret,
    config.oauth_google.redirect_uri
  );
}