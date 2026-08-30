import { jest, describe, it, beforeEach, expect } from "@jest/globals";

const mockEncodingForModel = jest.fn();
const mockGetEncoding = jest.fn();
const fakeEncoding = { encode: (txt: string) => txt.split(" ") };

jest.unstable_mockModule("js-tiktoken", () => ({
  encodingForModel: (model: string) => mockEncodingForModel(model),
  getEncoding: (name: string) => mockGetEncoding(name),
}));

let getTokensCount: typeof import("../../src/helpers/gpt/messages.ts").getTokensCount;

const baseConfig: { completionParams: { model: string } } = {
  completionParams: { model: "gpt-5-nano" },
};

describe("getTokensCount", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockEncodingForModel.mockReset();
    mockGetEncoding.mockReset();
    mockEncodingForModel.mockReturnValue(fakeEncoding);
    mockGetEncoding.mockReturnValue(fakeEncoding);
    ({ getTokensCount } = await import("../../src/helpers/gpt/messages.ts"));
  });

  it("uses model name to select encoding", () => {
    getTokensCount(baseConfig, "a b c");
    expect(mockEncodingForModel).toHaveBeenCalledWith("gpt-5-nano");
  });

  it("passes model name for 5 models", () => {
    const cfg: { completionParams: { model: string } } = {
      completionParams: { model: "gpt-5-mini" },
    };
    getTokensCount(cfg, "a b c");
    expect(mockEncodingForModel).toHaveBeenCalledWith("gpt-5-mini");
  });

  it("counts tokens using encoding", () => {
    const count = getTokensCount(baseConfig, "a b c");
    expect(count).toBe(3);
  });

  it("falls back to o200k_base for unknown model", () => {
    mockEncodingForModel.mockImplementation(() => {
      throw new Error("Unknown model");
    });
    const cfg: { completionParams: { model: string } } = {
      completionParams: { model: "gpt-5.1" },
    };
    const count = getTokensCount(cfg, "a b c");
    expect(mockGetEncoding).toHaveBeenCalledWith("o200k_base");
    expect(count).toBe(3);
  });
});
