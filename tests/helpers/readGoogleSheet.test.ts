import { jest, describe, it, beforeEach, expect } from "@jest/globals";
import type { OAuth2Client } from "google-auth-library";

const mockSheetsGet = jest.fn();
const mockValuesGet = jest.fn();

jest.unstable_mockModule("@googleapis/sheets", () => ({
  sheets: () => ({
    spreadsheets: {
      get: mockSheetsGet,
      values: { get: mockValuesGet },
    },
  }),
}));

let readGoogleSheetToRows: typeof import("../../src/helpers/readGoogleSheet.ts").default;

const auth = {} as unknown as OAuth2Client;

describe("readGoogleSheetToRows", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockSheetsGet.mockResolvedValue({
      data: { sheets: [{ properties: { title: "Sheet1" } }] },
    });
    mockValuesGet.mockResolvedValue({
      data: {
        values: [
          ["Name", "Age"],
          ["Alice", "30"],
        ],
      },
    });
    ({ default: readGoogleSheetToRows } = await import("../../src/helpers/readGoogleSheet.ts"));
  });

  it("returns empty array when auth missing", async () => {
    const mod = await import("../../src/helpers/readGoogleSheet.ts");
    const res = await mod.default("id", undefined as unknown as OAuth2Client);
    expect(res).toEqual([]);
  });

  it("converts rows to objects", async () => {
    const rows = await readGoogleSheetToRows("sheet", auth);
    expect(mockSheetsGet).toHaveBeenCalled();
    expect(mockValuesGet).toHaveBeenCalled();
    expect(rows).toEqual([{ Name: "Alice", Age: "30" }]);
  });
});
