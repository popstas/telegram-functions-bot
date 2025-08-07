import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { OAuth2Client } from "google-auth-library";
import type { ConfigChatType, ThreadStateType, ToolResponse } from "../../src/types.ts";

const mockReadConfig = jest.fn();
const mockReadSheet = jest.fn();

jest.unstable_mockModule("../../src/config.ts", () => ({
  readConfig: () => mockReadConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("../../src/helpers/readGoogleSheet.ts", () => ({
  default: (...args: unknown[]) => mockReadSheet(...args),
}));

let mod: typeof import("../../src/tools/read_google_sheet.ts");

beforeEach(async () => {
  jest.resetModules();
  mockReadConfig.mockReset();
  mockReadSheet.mockReset();
  mod = await import("../../src/tools/read_google_sheet.ts");
});

describe("GoogleSheetClient", () => {
  const auth = {} as OAuth2Client;

  it("returns sheet data", async () => {
    mockReadSheet.mockResolvedValue([{ a: 1 }]);
    const client = new mod.GoogleSheetClient(auth);
    const res = await client.read_google_sheet({ sheetId: "id" });
    expect(mockReadSheet).toHaveBeenCalledWith("id", auth);
    expect(res).toEqual({ content: '```json\n[{"a":1}]\n```' } as ToolResponse);
  });

  it("returns auth message when no data", async () => {
    mockReadSheet.mockResolvedValue(undefined);
    const client = new mod.GoogleSheetClient(auth);
    const res = await client.read_google_sheet({ sheetId: "id" });
    expect(res.content).toBe("No access token, auth with /google_auth");
  });

  it("options_string formats id", () => {
    const client = new mod.GoogleSheetClient(auth);
    expect(client.options_string('{"sheetId":"abc"}')).toBe(
      "Read Google sheet: https://docs.google.com/spreadsheets/d/abc",
    );
    expect(client.options_string("{}" as string)).toBe("{}");
  });

  it("call returns instance", () => {
    const cfg = {} as ConfigChatType;
    const thread = {
      id: 1,
      msgs: [],
      messages: [],
      authClient: auth,
    } as ThreadStateType;
    expect(mod.call(cfg, thread)).toBeInstanceOf(mod.GoogleSheetClient);
  });
});

export {};
