import { jest } from "@jest/globals";
import { replaceUrlPlaceholders, __clearUrlCache } from "../../src/helpers/placeholders.ts";

describe("replaceUrlPlaceholders", () => {
  beforeEach(() => {
    __clearUrlCache();
  });

  it("replaces url placeholder with fetched content and caches it", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ text: jest.fn().mockResolvedValue("OK") });
    global.fetch = fetchMock as unknown as typeof fetch;
    const text = "Status: {url:https://example.com/status.html}";
    const res1 = await replaceUrlPlaceholders(text);
    const res2 = await replaceUrlPlaceholders(text);
    expect(res1).toBe("Status: OK");
    expect(res2).toBe("Status: OK");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
