import {google} from "googleapis";
import {threads} from "../index.ts";
import {Credentials} from "google-auth-library/build/src/auth/credentials";
import fs from "fs";
import {readConfig} from "../config.ts";
import {OAuth2Client} from "google-auth-library/build/src/auth/oauth2client";
import {Message} from "telegraf/types";
import http from "http";
import url from "url";
import {GaxiosError} from "gaxios";
import {GoogleAuth} from "google-auth-library";
import {ThreadStateType} from "../types.ts";
import {sendTelegramMessage} from "./telegram.ts";

const credsFilePath = 'data/creds.json';

export function getUserGoogleCreds(user_id?: number): Credentials | undefined {
  if (!user_id) return;
  const creds = loadGoogleCreds();
  return creds[user_id];
}

// load/save data/creds.json, key is msg.from.id
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

export async function ensureAuth(user_id: number): Promise<OAuth2Client | GoogleAuth> {
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
        // console.log(tokens.refresh_token);
      }
      // console.log(tokens.access_token);
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
    config.auth.oauth_google?.client_id,
    config.auth.oauth_google?.client_secret,
    config.auth.oauth_google?.redirect_uri
  );
}

export function createAuthServer(oauth2Client: OAuth2Client, msg: Message.TextMessage) {
  const server = http.createServer((req, res) => {
    if (req.url) {
      const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
      const code = qs.get('code');
      if (code) {
        // Exchange code for tokens
        oauth2Client.getToken(code, (err: GaxiosError | null, creds: Credentials | null | undefined) => {
          if (err) {
            console.error('Error retrieving access creds', err);
            res.end('Error retrieving access creds');
            server.close();
            return;
          }
          oauth2Client.setCredentials(creds!);
          console.log('Token acquired:');
          // console.log(creds);
          void saveUserGoogleCreds(creds, msg?.from?.id);

          res.end('Authentication successful! You can close this window.');
          server.close();

          addOauthToThread(oauth2Client, threads, msg);
          void sendTelegramMessage(msg.chat.id, 'Google auth successful, you can use google functions');
        });
      } else {
        res.end('No code found in the query string.');
      }
    } else {
      res.end('No query string found.');
    }
  });

  server.listen(3000, () => {
    console.log('Listening on port 3000 for OAuth callback...');
  });

  return server;
}

export function addOauthToThread(authClient: OAuth2Client | GoogleAuth, threads: {
  [key: number]: ThreadStateType
}, msg: Message.TextMessage) {
  // global threads
  const key = msg.chat?.id
  if (!key) return
  if (!threads[key]) {
    threads[key] = {
      msgs: [],
      messages: [],
    }
  }
  threads[key].authClient = authClient
}

export async function commandGoogleOauth(msg: Message.TextMessage) {
  const authClient = await ensureAuth(msg.from?.id || 0);

  // login with link
  const oAuth2Client = authClient as OAuth2Client;
  if (oAuth2Client.credentials && !oAuth2Client.credentials?.access_token) {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });

    await sendTelegramMessage(msg?.chat?.id, `Please authenticate with Google: ${authUrl}`);

    createAuthServer(oAuth2Client, msg);
    return
  }

  addOauthToThread(authClient, threads, msg);
  await sendTelegramMessage(msg.chat?.id, 'Google auth successful, now you can use google functions');
}