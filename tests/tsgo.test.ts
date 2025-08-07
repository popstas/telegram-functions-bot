import { execSync } from "node:child_process";
import { describe, expect, it } from "@jest/globals";

describe("tsgo", () => {
  it("reports version", () => {
    const output = execSync("npx tsgo --version", { encoding: "utf8" }).trim();
    expect(output).toMatch(/[0-9]+\.[0-9]+\.[0-9]+/);
  });
});
