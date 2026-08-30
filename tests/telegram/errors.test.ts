import { describe, it, expect } from "@jest/globals";
import { makeGrammyError } from "../testHelpers.ts";
const { getRetryAfterMs, isBlockedByUser, isInvalidToken, getErrorDescription } = await import(
  "../../src/telegram/errors.ts"
);

describe("telegram/errors (grammY shapes)", () => {
  it("getRetryAfterMs reads 429 retry_after in ms", () => {
    const err = makeGrammyError(429, "Too Many Requests", { retry_after: 5 });
    expect(getRetryAfterMs(err)).toBe(5000);
    expect(getRetryAfterMs(makeGrammyError(400))).toBeUndefined();
    expect(getRetryAfterMs(new Error("x"))).toBeUndefined();
  });
  it("isBlockedByUser detects 403", () => {
    expect(isBlockedByUser(makeGrammyError(403, "Forbidden: bot was blocked by the user"))).toBe(
      true,
    );
    expect(isBlockedByUser(makeGrammyError(400))).toBe(false);
  });
  it("isInvalidToken detects 401", () => {
    expect(isInvalidToken(makeGrammyError(401, "Unauthorized"))).toBe(true);
    expect(isInvalidToken(new Error("nope"))).toBe(false);
  });
  it("getErrorDescription prefers description, falls back to message", () => {
    expect(getErrorDescription(makeGrammyError(400, "wrong file_id"))).toBe("wrong file_id");
    expect(getErrorDescription(new Error("boom"))).toBe("boom");
    expect(getErrorDescription("weird")).toBe("weird");
  });
});
