import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockTmpNameSync = jest.fn();
const mockExec = jest.fn(
  (cmd: string, cb: (err: unknown, out: string) => void) => cb(null, ""),
);
const mockAccess = jest.fn();
const mockReadFile = jest.fn();

jest.unstable_mockModule("tmp", () => ({
  __esModule: true,
  default: {
    tmpNameSync: mockTmpNameSync,
    setGracefulCleanup: jest.fn(),
  },
  tmpNameSync: mockTmpNameSync,
  setGracefulCleanup: jest.fn(),
}));

jest.unstable_mockModule("child_process", () => ({
  __esModule: true,
  exec: mockExec,
}));

jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  default: {
    promises: { access: mockAccess, readFile: mockReadFile },
    constants: { R_OK: 0 },
  },
  promises: { access: mockAccess, readFile: mockReadFile },
  constants: { R_OK: 0 },
}));

const mockUseConfig = jest.fn(() => ({
  stt: { whisperBaseUrl: "http://base" },
}));

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

let stt: typeof import("../../src/helpers/stt.ts");

beforeEach(async () => {
  jest.resetModules();
  mockTmpNameSync.mockReturnValue("/tmp/file.mp3");
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn();
  stt = await import("../../src/helpers/stt.ts");
});

describe("convertToMp3", () => {
  it("calls ffmpeg and returns path", async () => {
    const res = await stt.convertToMp3("input.wav");
    expect(mockTmpNameSync).toHaveBeenCalled();
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("ffmpeg"),
      expect.any(Function),
    );
    expect(res).toBe("/tmp/file.mp3");
  });
});

describe("detectAudioFileLanguage", () => {
  it("posts file and parses json", async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue(Buffer.from("data") as never);
    (fetch as unknown as jest.Mock).mockResolvedValue({
      ok: true,
      text: jest.fn().mockResolvedValue('{"lang":"en"}' as never),
      headers: { entries: () => [] },
    } as never);
    const res = await stt.detectAudioFileLanguage("/tmp/file.mp3");
    expect(fetch).toHaveBeenCalledWith(
      "http://base/detect-language",
      expect.objectContaining({ method: "POST" }),
    );
    expect(res).toEqual({ lang: "en" });
  });

  it("throws on non-ok response", async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue(Buffer.from("data") as never);
    (fetch as unknown as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "bad",
      text: jest.fn().mockResolvedValue("err" as never),
      headers: { entries: () => [] },
    } as never);
    await expect(stt.detectAudioFileLanguage("/tmp/file.mp3")).rejects.toThrow(
      "HTTP error! status: 400, body: err",
    );
  });
});

describe("sendAudioWhisper", () => {
  it("sends file and returns json", async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue(Buffer.from("data") as never);
    (fetch as unknown as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue('{"detected_language":"en"}' as never),
        headers: { entries: () => [] },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: jest.fn().mockResolvedValue({ text: "ok" } as never),
        headers: { entries: () => [] },
      } as never);
    const res = await stt.sendAudioWhisper({ mp3Path: "p", prompt: "hi" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/asr?"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(res).toEqual({ text: "ok" });
  });

  it("throws on fetch error", async () => {
    mockAccess.mockResolvedValue(undefined as never);
    mockReadFile.mockResolvedValue(Buffer.from("data") as never);
    (fetch as unknown as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        text: jest
          .fn()
          .mockResolvedValue('{"detected_language":"en"}' as never),
        headers: { entries: () => [] },
      } as never)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue("oops" as never),
        headers: { entries: () => [] },
      } as never);
    await expect(
      stt.sendAudioWhisper({ mp3Path: "p", prompt: "hi" }),
    ).rejects.toThrow("HTTP error! status: 500, body: oops");
  });
});
