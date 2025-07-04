import { describe, it, expect } from "@jest/globals";
import { splitBigMessage } from "../../src/utils/text.ts";

describe("splitBigMessage", () => {
  it("splits long text into multiple messages", () => {
    const long1 = "a".repeat(4000);
    const long2 = "b".repeat(200);
    const res = splitBigMessage(`${long1}\n${long2}`);
    expect(res.length).toBe(2);
    expect(res[0]).toContain(long1);
    expect(res[1]).toContain(long2);
  });

  it("truncates single oversized line", () => {
    const line = "x".repeat(4100);
    const [msg] = splitBigMessage(line);
    expect(msg.length).toBe(4096);
    expect(msg.endsWith("...")).toBe(true);
  });

  it("keeps blank lines", () => {
    const res = splitBigMessage("a\n\nb");
    expect(res).toEqual(["a\n\nb\n"]);
  });
});
