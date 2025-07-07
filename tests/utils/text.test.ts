import { describe, it, expect } from "@jest/globals";
import { splitBigMessage, prettyText } from "../../src/utils/text.ts";

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

describe("prettyText", () => {
  it("formats a simple sentence correctly", () => {
    const input = "Hello world.";
    const result = prettyText(input);
    expect(result).toBe("Hello world. ");
  });

  it("combines short sentences into one paragraph", () => {
    const input = "First sentence. Second sentence. Third sentence.";
    const result = prettyText(input);
    expect(result).toBe("First sentence. Second sentence. Third sentence. ");
  });

  it("splits long text into multiple paragraphs", () => {
    const longText = 
      "This is a long sentence that should be in the first paragraph. " +
      "This is another long sentence that should be in the first paragraph. " +
      "This is a very long sentence that should trigger a new paragraph because " +
      "it makes the total length exceed the 200 character limit. " +
      "This should be in the second paragraph.";
    
    const result = prettyText(longText);
    const paragraphs = result.split("\n\n");
    
    expect(paragraphs.length).toBe(2);
    expect(paragraphs[0].length).toBeGreaterThan(200);
    expect(paragraphs[0]).toContain("first paragraph.");
    expect(paragraphs[1]).toContain("second paragraph.");
  });

  it("handles different sentence terminators", () => {
    const input = "Is this a question? Yes, it is! And this is a statement.";
    const result = prettyText(input);
    expect(result).toContain("Is this a question?");
    expect(result).toContain("Yes, it is!");
    expect(result).toContain("And this is a statement.");
  });

  it("handles empty string", () => {
    expect(prettyText("")).toBe("");
  });

  it("handles single word", () => {
    expect(prettyText("Hello")).toBe("Hello. ");
  });
});
