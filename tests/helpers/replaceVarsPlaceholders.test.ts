import { replaceVarsPlaceholders } from "../../src/helpers/placeholders";

describe("replaceVarsPlaceholders", () => {
  it("replaces vars and blocks", () => {
    const text = "Hello\n\n<vars:from>Ref: {vars:from}</vars:from>";
    const res = replaceVarsPlaceholders(text, { from: "pop" });
    expect(res).toBe("Hello\n\nRef: pop");
  });

  it("removes block when var missing", () => {
    const text = "Hello\n\n<vars:from>Ref: {vars:from}</vars:from>";
    const res = replaceVarsPlaceholders(text, {});
    expect(res).toBe("Hello\n\n");
  });
});
