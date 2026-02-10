import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { mkdtempSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockLog = jest.fn();

jest.unstable_mockModule("../src/helpers.ts", () => ({
  __esModule: true,
  log: (...args: unknown[]) => mockLog(...args),
  safeFilename: jest.fn(),
  stringToId: jest.fn(),
}));

let FileOAuthProvider: typeof import("../src/mcp-auth.ts").FileOAuthProvider;
let createAuthProvider: typeof import("../src/mcp-auth.ts").createAuthProvider;
let storePendingAuth: typeof import("../src/mcp-auth.ts").storePendingAuth;
let completePendingAuth: typeof import("../src/mcp-auth.ts").completePendingAuth;
let __testAuth: typeof import("../src/mcp-auth.ts").__testAuth;

let tmp: string;

beforeEach(async () => {
  jest.resetModules();
  mockLog.mockReset();
  ({ FileOAuthProvider, createAuthProvider, storePendingAuth, completePendingAuth, __testAuth } =
    await import("../src/mcp-auth.ts"));
  tmp = mkdtempSync(join(tmpdir(), "mcp-auth-test-"));
});

afterEach(() => {
  __testAuth.clearPendingAuths();
  rmSync(tmp, { recursive: true, force: true });
});

describe("FileOAuthProvider", () => {
  it("creates store directory on construction", () => {
    const dir = join(tmp, "sub", "dir");
    new FileOAuthProvider("test-server", "https://cb.example.com/callback", dir);
    expect(existsSync(dir)).toBe(true);
  });

  it("returns redirectUrl from constructor", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    expect(provider.redirectUrl).toBe("https://cb.example.com/callback");
  });

  it("returns correct clientMetadata", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    const meta = provider.clientMetadata;
    expect(meta.redirect_uris).toEqual(["https://cb.example.com/callback"]);
    expect(meta.client_name).toBe("telegram-functions-bot");
    expect(meta.grant_types).toContain("authorization_code");
    expect(meta.grant_types).toContain("refresh_token");
  });

  it("state() returns server name", () => {
    const provider = new FileOAuthProvider("my-server", "https://cb.example.com/callback", tmp);
    expect(provider.state()).toBe("my-server");
  });

  it("clientInformation returns undefined when no file", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    expect(provider.clientInformation()).toBeUndefined();
  });

  it("saves and loads client information", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    const info = { client_id: "id123", client_secret: "secret" };
    provider.saveClientInformation(info);
    expect(provider.clientInformation()).toEqual(info);
    expect(existsSync(join(tmp, "client.json"))).toBe(true);
  });

  it("tokens returns undefined when no file", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    expect(provider.tokens()).toBeUndefined();
  });

  it("saves and loads tokens", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    const tokens = { access_token: "at", token_type: "Bearer", refresh_token: "rt" };
    provider.saveTokens(tokens);
    expect(provider.tokens()).toEqual(tokens);
  });

  it("saves and loads code verifier", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    provider.saveCodeVerifier("verifier123");
    expect(provider.codeVerifier()).toBe("verifier123");
  });

  it("redirectToAuthorization logs the URL", () => {
    const provider = new FileOAuthProvider("test-srv", "https://cb.example.com/callback", tmp);
    const url = new URL("https://auth.example.com/authorize?client_id=123");
    provider.redirectToAuthorization(url);
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("https://auth.example.com/authorize?client_id=123"),
        logLevel: "warn",
      }),
    );
  });

  it("redirectToAuthorization calls onAuthUrl callback", () => {
    const onAuthUrl = jest.fn();
    const provider = new FileOAuthProvider(
      "test-srv",
      "https://cb.example.com/callback",
      tmp,
      onAuthUrl,
    );
    const url = new URL("https://auth.example.com/authorize?client_id=123");
    provider.redirectToAuthorization(url);
    expect(onAuthUrl).toHaveBeenCalledWith(url);
  });

  it("redirectToAuthorization works without onAuthUrl callback", () => {
    const provider = new FileOAuthProvider("test-srv", "https://cb.example.com/callback", tmp);
    const url = new URL("https://auth.example.com/authorize?client_id=123");
    expect(() => provider.redirectToAuthorization(url)).not.toThrow();
  });

  it("invalidateCredentials('all') removes all files", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    provider.saveClientInformation({ client_id: "id" });
    provider.saveTokens({ access_token: "at", token_type: "Bearer" });
    provider.saveCodeVerifier("v");

    provider.invalidateCredentials("all");

    expect(existsSync(join(tmp, "client.json"))).toBe(false);
    expect(existsSync(join(tmp, "tokens.json"))).toBe(false);
    expect(existsSync(join(tmp, "code_verifier.txt"))).toBe(false);
  });

  it("invalidateCredentials('tokens') removes only tokens", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    provider.saveClientInformation({ client_id: "id" });
    provider.saveTokens({ access_token: "at", token_type: "Bearer" });

    provider.invalidateCredentials("tokens");

    expect(existsSync(join(tmp, "client.json"))).toBe(true);
    expect(existsSync(join(tmp, "tokens.json"))).toBe(false);
  });

  it("invalidateCredentials('client') removes only client", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    provider.saveClientInformation({ client_id: "id" });
    provider.saveTokens({ access_token: "at", token_type: "Bearer" });

    provider.invalidateCredentials("client");

    expect(existsSync(join(tmp, "client.json"))).toBe(false);
    expect(existsSync(join(tmp, "tokens.json"))).toBe(true);
  });

  it("clientInformation returns undefined for corrupted JSON", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    writeFileSync(join(tmp, "client.json"), "not json");
    expect(provider.clientInformation()).toBeUndefined();
  });

  it("tokens returns undefined for corrupted JSON", () => {
    const provider = new FileOAuthProvider("test", "https://cb.example.com/callback", tmp);
    writeFileSync(join(tmp, "tokens.json"), "not json");
    expect(provider.tokens()).toBeUndefined();
  });
});

describe("createAuthProvider", () => {
  it("returns undefined when no auth config", () => {
    expect(createAuthProvider("srv", { url: "http://localhost" })).toBeUndefined();
  });

  it("returns FileOAuthProvider when auth config is present", () => {
    const provider = createAuthProvider("srv", {
      url: "http://localhost",
      auth: { callbackUrl: "https://cb.example.com/callback" },
    });
    expect(provider).toBeInstanceOf(FileOAuthProvider);
    expect(provider!.redirectUrl).toBe("https://cb.example.com/callback");
  });

  it("uses custom storePath when provided", () => {
    const storePath = join(tmp, "custom-store");
    const provider = createAuthProvider("srv", {
      url: "http://localhost",
      auth: { callbackUrl: "https://cb.example.com/callback", storePath },
    });
    expect(existsSync(storePath)).toBe(true);
    // Verify it works by saving/loading
    provider!.saveTokens({ access_token: "test", token_type: "Bearer" });
    expect(existsSync(join(storePath, "tokens.json"))).toBe(true);
  });

  it("passes onAuthUrl to FileOAuthProvider", () => {
    const onAuthUrl = jest.fn();
    const storePath = join(tmp, "auth-url-test");
    const provider = createAuthProvider(
      "srv",
      {
        url: "http://localhost",
        auth: { callbackUrl: "https://cb.example.com/callback", storePath },
      },
      onAuthUrl,
    );
    expect(provider).toBeInstanceOf(FileOAuthProvider);
    const url = new URL("https://auth.example.com/authorize");
    provider!.redirectToAuthorization(url);
    expect(onAuthUrl).toHaveBeenCalledWith(url);
  });
});

describe("completePendingAuth", () => {
  it("returns false when no pending auth", async () => {
    const result = await completePendingAuth("unknown", "code123");
    expect(result).toBe(false);
  });

  it("calls finishAuth on transport and returns true", async () => {
    const mockFinishAuth = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockTransport = {
      finishAuth: mockFinishAuth,
    } as unknown as import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;

    storePendingAuth("test-server", mockTransport, "test-model");
    const result = await completePendingAuth("test-server", "auth-code-123");

    expect(result).toBe(true);
    expect(mockFinishAuth).toHaveBeenCalledWith("auth-code-123");
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("OAuth authorization completed successfully"),
      }),
    );
  });

  it("returns false and logs error when finishAuth throws", async () => {
    const mockFinishAuth = jest
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("token exchange failed"));
    const mockTransport = {
      finishAuth: mockFinishAuth,
    } as unknown as import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;

    storePendingAuth("test-server", mockTransport, "test-model");
    const result = await completePendingAuth("test-server", "bad-code");

    expect(result).toBe(false);
    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining("token exchange failed"),
        logLevel: "error",
      }),
    );
  });

  it("removes pending auth after successful completion", async () => {
    const mockFinishAuth = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const mockTransport = {
      finishAuth: mockFinishAuth,
    } as unknown as import("@modelcontextprotocol/sdk/client/streamableHttp.js").StreamableHTTPClientTransport;

    storePendingAuth("test-server", mockTransport, "test-model");
    await completePendingAuth("test-server", "code");

    // Second call should return false since it was removed
    const result = await completePendingAuth("test-server", "code");
    expect(result).toBe(false);
  });
});
