import { jest, describe, it, beforeEach, expect } from "@jest/globals";

const mockUseConfig = jest.fn();
const mockOpenAI = jest.fn(function (
  this: Record<string, unknown>,
  opts: Record<string, unknown>,
) {
  Object.assign(this, { opts });
});

jest.unstable_mockModule("../../src/config.ts", () => ({
  useConfig: () => mockUseConfig(),
  updateChatInConfig: jest.fn(),
}));

jest.unstable_mockModule("openai", () => ({
  default: mockOpenAI,
  OpenAI: mockOpenAI,
}));

let useApi: (model?: string) => unknown;

describe("useApi", () => {
  beforeEach(async () => {
    jest.resetModules();
    mockOpenAI.mockClear();
    mockUseConfig.mockReturnValue({
      auth: { chatgpt_api_key: "key", proxy_url: "" },
      local_models: [{ name: "local", url: "http://local" }],
    });
    const mod = await import("../../src/helpers/useApi.ts");
    useApi = mod.useApi;
  });

  it("creates and caches default api", () => {
    const api1 = useApi();
    const api2 = useApi();
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
    expect(api1).toBe(api2);
    expect(api1.opts.apiKey).toBe("key");
  });

  it("creates separate instance for local model", () => {
    const api1 = useApi("local");
    const api2 = useApi("local");
    expect(mockOpenAI).toHaveBeenCalledTimes(1);
    expect(api1).toBe(api2);
    expect(api1.opts.baseURL).toBe("http://local/v1");
  });
});
