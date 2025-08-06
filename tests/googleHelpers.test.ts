import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Credentials } from "google-auth-library";
import type { Message } from "telegraf/types";

const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockWatchFile = jest.fn();
const mockWatch = jest.fn();
const mockMkdirSync = jest.fn();
const mockReaddirSync = jest.fn();

jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    watchFile: mockWatchFile,
    watch: mockWatch,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  watchFile: mockWatchFile,
  watch: mockWatch,
  mkdirSync: mockMkdirSync,
  readdirSync: mockReaddirSync,
}));

let googleHelpers: typeof import("../src/helpers/google.ts");

beforeEach(async () => {
  jest.resetModules();
  mockExistsSync.mockReset();
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockMkdirSync.mockReset();
  mockReaddirSync.mockReset();
  mockWatch.mockReset();
  googleHelpers = await import("../src/helpers/google.ts");
});

describe("google helpers", () => {
  it("loadGoogleCreds returns empty object when file missing", () => {
    mockExistsSync.mockReturnValue(false);
    const res = googleHelpers.loadGoogleCreds();
    expect(res).toEqual({});
    expect(mockExistsSync).toHaveBeenCalled();
  });

  it("loadGoogleCreds returns parsed creds", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"1":{"t":1}}\n');
    const res = googleHelpers.loadGoogleCreds();
    expect(res).toEqual({ 1: { t: 1 } });
    expect(mockReadFileSync).toHaveBeenCalled();
  });

  it("getUserGoogleCreds handles missing id", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    const res = googleHelpers.getUserGoogleCreds();
    expect(res).toBeUndefined();
  });

  it("getUserGoogleCreds returns creds for id", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{"2":{"a":1}}');
    const res = googleHelpers.getUserGoogleCreds(2);
    expect(res).toEqual({ a: 1 });
  });

  it("saveUserGoogleCreds logs error when no user_id", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    googleHelpers.saveUserGoogleCreds(
      { token: "t" } as unknown as Credentials,
      undefined as unknown as number,
    );
    expect(err).toHaveBeenCalledWith("No user_id to save creds");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("saveUserGoogleCreds logs error when no creds", () => {
    const err = jest.spyOn(console, "error").mockImplementation(() => {});
    googleHelpers.saveUserGoogleCreds(undefined, 1);
    expect(err).toHaveBeenCalledWith("No creds to save");
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("saveUserGoogleCreds writes merged creds", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("{}");
    googleHelpers.saveUserGoogleCreds(
      { token: "t" } as unknown as Credentials,
      3,
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("creds.json"),
      JSON.stringify({ 3: { token: "t" } }, null, 2),
      "utf-8",
    );
  });

  it("addOauthToThread creates thread and sets auth", () => {
    const threads: Record<number, Record<string, unknown>> = {};
    const msg = { chat: { id: 5 } } as unknown as Message.TextMessage;
    const authClient = {} as unknown as Credentials;
    googleHelpers.addOauthToThread(authClient, threads, msg);
    expect(threads[5]).toBeDefined();
    expect(threads[5].authClient).toBe(authClient);
  });
});
