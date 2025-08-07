import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Context, Message } from "telegraf/types";
import type { ConfigChatType } from "../../src/types.ts";

const mockCheckAccessLevel = jest.fn();
const mockProcessImageMessage = jest.fn();
const mockOnUnsupported = jest.fn();
const mockOnTextMessage = jest.fn();

jest.unstable_mockModule("../../src/handlers/access.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCheckAccessLevel(...args),
}));

jest.unstable_mockModule("../../src/helpers/vision.ts", () => ({
  processImageMessage: (...args: unknown[]) => mockProcessImageMessage(...args),
}));

jest.unstable_mockModule("../../src/handlers/onUnsupported.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOnUnsupported(...args),
}));

jest.unstable_mockModule("../../src/handlers/onTextMessage.ts", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockOnTextMessage(...args),
}));

let onDocument: typeof import("../../src/handlers/onDocument.ts").default;

function createCtx(message: Record<string, unknown>): Context {
  return {
    message,
    update: { message },
    persistentChatAction: async (_: string, fn: () => Promise<void>) => {
      await fn();
    },
  } as unknown as Context;
}

beforeEach(async () => {
  jest.clearAllMocks();
  jest.resetModules();
  onDocument = (await import("../../src/handlers/onDocument.ts")).default;
});

describe("onDocument", () => {
  it("processes image documents", async () => {
    const msg = {
      chat: { id: 1, type: "private", title: "t" },
      document: { file_id: "f", mime_type: "image/png" },
      caption: "cap",
    } as Message.DocumentMessage;
    const chat = {} as ConfigChatType;
    mockCheckAccessLevel.mockResolvedValue({ msg, chat });
    mockProcessImageMessage.mockImplementation(async () => {
      mockOnTextMessage({ message: { text: "cap\n\nImage contents: ocr" } });
    });
    const ctx = createCtx(msg);
    await onDocument(ctx);
    expect(mockProcessImageMessage).toHaveBeenCalledWith(ctx, msg, chat, "upload_document");
    expect(mockOnUnsupported).not.toHaveBeenCalled();
    expect(mockOnTextMessage).toHaveBeenCalled();
  });

  it("redirects non-image documents", async () => {
    const msg = {
      chat: { id: 1, type: "private", title: "t" },
      document: { file_id: "f", mime_type: "application/pdf" },
    } as Message.DocumentMessage;
    mockCheckAccessLevel.mockResolvedValue({ msg, chat: {} as ConfigChatType });
    const ctx = createCtx(msg);
    await onDocument(ctx);
    expect(mockOnUnsupported).toHaveBeenCalledWith(ctx);
    expect(mockProcessImageMessage).not.toHaveBeenCalled();
  });
});
