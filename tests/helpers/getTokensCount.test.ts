import { jest, describe, it, beforeEach, expect } from "@jest/globals";

const mockEncodingForModel = jest.fn();
const fakeEncoding = { encode: (txt: string) => txt.split(" ") };

jest.unstable_mockModule("js-tiktoken", () => ({
  encodingForModel: (model: string) => mockEncodingForModel(model),
}));

let getTokensCount: typeof import("../../src/helpers/gpt/messages.ts").getTokensCount;

const baseConfig: { completionParams: { model: string } } = {
  completionParams: { model: "gpt-5-nano" },
};

describe("getTokensCount", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockEncodingForModel.mockReturnValue(fakeEncoding);
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
});
