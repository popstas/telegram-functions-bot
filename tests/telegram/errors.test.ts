import { describe, it, expect } from "@jest/globals";
const { getRetryAfterMs, isBlockedByUser, isInvalidToken, getErrorDescription } = await import(
  "../../src/telegram/errors.ts"
);

describe("telegram/errors (telegraf shapes)", () => {
  it("getRetryAfterMs reads 429 retry_after in ms", () => {
    const err = { response: { error_code: 429, parameters: { retry_after: 5 } } };
    expect(getRetryAfterMs(err)).toBe(5000);
    expect(getRetryAfterMs({ response: { error_code: 400 } })).toBeUndefined();
    expect(getRetryAfterMs(new Error("x"))).toBeUndefined();
  });
  it("isBlockedByUser detects 403", () => {
    expect(
      isBlockedByUser({
        response: { error_code: 403, description: "Forbidden: bot was blocked by the user" },
      }),
    ).toBe(true);
    expect(isBlockedByUser({ response: { error_code: 400 } })).toBe(false);
  });
  it("isInvalidToken detects 401 via statusCode or error_code", () => {
    expect(isInvalidToken({ response: { statusCode: 401 } })).toBe(true);
    expect(isInvalidToken({ response: { error_code: 401 } })).toBe(true);
    expect(isInvalidToken(new Error("nope"))).toBe(false);
  });
  it("getErrorDescription prefers response.description, falls back to message", () => {
    expect(getErrorDescription({ response: { description: "wrong file_id" } })).toBe(
      "wrong file_id",
    );
    expect(getErrorDescription(new Error("boom"))).toBe("boom");
    expect(getErrorDescription("weird")).toBe("weird");
  });
});
