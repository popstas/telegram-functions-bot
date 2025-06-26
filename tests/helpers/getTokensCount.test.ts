import { jest, describe, it, beforeEach, expect } from "@jest/globals";

const mockGetEncoding = jest.fn();
const fakeEncoding = { encode: (txt: string) => txt.split(" ") };

jest.unstable_mockModule("js-tiktoken", () => ({
  getEncoding: (name: string) => mockGetEncoding(name),
}));

let getTokensCount: typeof import("../../src/helpers/gpt/messages.ts").getTokensCount;

const baseConfig: { completionParams: { model: string } } = {
  completionParams: { model: "gpt-3.5-turbo" },
};

describe("getTokensCount", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockGetEncoding.mockReturnValue(fakeEncoding);
    ({ getTokensCount } = await import("../../src/helpers/gpt/messages.ts"));
  });

  it("uses cl100k_base encoding by default", () => {
    getTokensCount(baseConfig, "a b c");
    expect(mockGetEncoding).toHaveBeenCalledWith("cl100k_base");
  });

  it("uses o200k_base for 4o models", () => {
    const cfg: { completionParams: { model: string } } = {
      completionParams: { model: "gpt-4o" },
    };
    getTokensCount(cfg, "a b c");
    expect(mockGetEncoding).toHaveBeenCalledWith("o200k_base");
  });

  it("counts tokens using encoding", () => {
    const count = getTokensCount(baseConfig, "a b c");
    expect(count).toBe(3);
  });
});
