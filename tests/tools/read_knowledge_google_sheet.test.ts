import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { ConfigChatType, ThreadStateType } from "../../src/types.ts";
import { OAuth2Client } from "google-auth-library";

const mockReadSheet = jest.fn();

jest.unstable_mockModule("../../src/helpers/readGoogleSheet", () => ({
  readGoogleSheet: jest.fn(),
  default: (...args: unknown[]) => mockReadSheet(...args),
}));

let mod: typeof import("../../src/tools/read_knowledge_google_sheet.ts");

function cfg(): ConfigChatType {
  return {
    name: "chat",
    agent_name: "agent",
    completionParams: {},
    chatParams: {},
    toolParams: {
      knowledge_google_sheet: {
        sheetId: "id",
        titleCol: "title",
        textCol: "text",
      },
    },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  mockReadSheet.mockReset();
  mod = await import("../../src/tools/read_knowledge_google_sheet.ts");
});

describe("KnowledgeGoogleSheetClient", () => {
  it("reads sheet and caches", async () => {
    mockReadSheet.mockResolvedValue([
      { title: "A", text: "1" },
      { title: "B", text: "2" },
    ]);
    const client = new mod.KnowledgeGoogleSheetClient(
      cfg(),
      {} as OAuth2Client,
    );
    const res = await client.read_knowledge_google_sheet({ title: "B" });
    expect(res.content).toBe("2");
    await client.read_knowledge_google_sheet({ title: "A" });
    expect(mockReadSheet).toHaveBeenCalledTimes(1);
  });

  it("returns default message when not found", async () => {
    mockReadSheet.mockResolvedValue([{ title: "A", text: "1" }]);
    const client = new mod.KnowledgeGoogleSheetClient(
      cfg(),
      {} as OAuth2Client,
    );
    const res = await client.read_knowledge_google_sheet({ title: "X" });
    expect(res.content).toBe("No answer found for X");
  });

  it("options_string formats title", () => {
    const client = new mod.KnowledgeGoogleSheetClient(
      cfg(),
      {} as OAuth2Client,
    );
    expect(client.options_string('{"title":"T"}')).toBe(
      "**Google sheet:** `T`",
    );
  });

  it("prompt_append lists titles", async () => {
    mockReadSheet.mockResolvedValue([
      { title: "A", text: "1" },
      { title: "B", text: "2" },
    ]);
    const client = new mod.KnowledgeGoogleSheetClient(
      cfg(),
      {} as OAuth2Client,
    );
    const txt = await client.prompt_append();
    expect(txt).toContain("- A");
    expect(txt).toContain("- B");
  });

  it("call returns instance", () => {
    const inst = mod.call(cfg(), {
      authClient: {} as OAuth2Client,
    } as ThreadStateType);
    expect(inst).toBeInstanceOf(mod.KnowledgeGoogleSheetClient);
  });
});
