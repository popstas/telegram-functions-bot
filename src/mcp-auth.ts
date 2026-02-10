import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientMetadata,
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpToolConfig } from "./types.ts";
import { log } from "./helpers.ts";

const CLIENT_FILE = "client.json";
const TOKENS_FILE = "tokens.json";
const CODE_VERIFIER_FILE = "code_verifier.txt";

/**
 * File-based OAuth client provider for MCP servers.
 * Persists OAuth state (client info, tokens, PKCE verifier) to disk.
 */
export class FileOAuthProvider implements OAuthClientProvider {
  private storePath: string;
  private callbackUrl: string;
  private serverName: string;

  constructor(serverName: string, callbackUrl: string, storePath: string) {
    this.serverName = serverName;
    this.callbackUrl = callbackUrl;
    this.storePath = storePath;
    mkdirSync(this.storePath, { recursive: true });
  }

  get redirectUrl(): string {
    return this.callbackUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.callbackUrl],
      client_name: "telegram-functions-bot",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_basic",
    };
  }

  state(): string {
    return this.serverName;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const path = join(this.storePath, CLIENT_FILE);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as OAuthClientInformationMixed;
    } catch {
      return undefined;
    }
  }

  saveClientInformation(info: OAuthClientInformationMixed): void {
    writeFileSync(join(this.storePath, CLIENT_FILE), JSON.stringify(info, null, 2));
  }

  tokens(): OAuthTokens | undefined {
    const path = join(this.storePath, TOKENS_FILE);
    if (!existsSync(path)) return undefined;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as OAuthTokens;
    } catch {
      return undefined;
    }
  }

  saveTokens(tokens: OAuthTokens): void {
    writeFileSync(join(this.storePath, TOKENS_FILE), JSON.stringify(tokens, null, 2));
  }

  saveCodeVerifier(verifier: string): void {
    writeFileSync(join(this.storePath, CODE_VERIFIER_FILE), verifier);
  }

  codeVerifier(): string {
    return readFileSync(join(this.storePath, CODE_VERIFIER_FILE), "utf-8");
  }

  redirectToAuthorization(url: URL): void {
    log({
      msg: `[${this.serverName}] OAuth authorization required. Visit this URL to authorize:\n${url.toString()}`,
      logLevel: "warn",
    });
  }

  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): void {
    const remove = (file: string) => {
      const path = join(this.storePath, file);
      if (existsSync(path)) unlinkSync(path);
    };

    if (scope === "all" || scope === "tokens") remove(TOKENS_FILE);
    if (scope === "all" || scope === "client") remove(CLIENT_FILE);
    if (scope === "all" || scope === "verifier") remove(CODE_VERIFIER_FILE);
  }
}

// --- Pending auth management ---

type PendingAuth = {
  transport: StreamableHTTPClientTransport;
  model: string;
};

const pendingAuths = new Map<string, PendingAuth>();

/**
 * Create a FileOAuthProvider if auth config is present, otherwise undefined.
 */
export function createAuthProvider(
  serverName: string,
  cfg: McpToolConfig,
): FileOAuthProvider | undefined {
  if (!cfg.auth) return undefined;
  const storePath = cfg.auth.storePath || `data/mcp-auth/${serverName}`;
  return new FileOAuthProvider(serverName, cfg.auth.callbackUrl, storePath);
}

/**
 * Store a pending auth transport so the callback route can complete it.
 */
export function storePendingAuth(
  serverName: string,
  transport: StreamableHTTPClientTransport,
  model: string,
): void {
  pendingAuths.set(serverName, { transport, model });
}

/**
 * Complete a pending OAuth flow by passing the authorization code to the transport.
 * Returns true if the auth was completed successfully.
 */
export async function completePendingAuth(state: string, code: string): Promise<boolean> {
  const pending = pendingAuths.get(state);
  if (!pending) return false;

  try {
    await pending.transport.finishAuth(code);
    pendingAuths.delete(state);
    log({
      msg: `[${pending.model}] OAuth authorization completed successfully`,
    });
    return true;
  } catch (err) {
    log({
      msg: `[${pending.model}] OAuth finishAuth failed: ${err instanceof Error ? err.message : String(err)}`,
      logLevel: "error",
    });
    return false;
  }
}

/** Test helpers */
export const __testAuth = {
  clearPendingAuths() {
    pendingAuths.clear();
  },
  getPendingAuth(state: string) {
    return pendingAuths.get(state);
  },
};
