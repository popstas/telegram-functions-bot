import { describe, it, expect, afterEach, beforeEach, jest } from "@jest/globals";

const versions = process.versions as Record<string, string | undefined>;
const originalElectron = versions.electron;
const hadElectron = Object.prototype.hasOwnProperty.call(versions, "electron");

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  if (hadElectron) {
    versions.electron = originalElectron;
  } else {
    delete versions.electron;
  }
  delete process.env.BETTER_SQLITE3_ALLOW_ELECTRON;
  jest.resetModules();
});

describe("shouldLoadBetterSqlite3", () => {
  it("skips loading under Electron without override", async () => {
    versions.electron = "29.0.0";
    const module = await import("../../src/helpers/embeddings.ts");
    expect(module.shouldLoadBetterSqlite3()).toBe(false);
  });

  it("allows loading when override flag set", async () => {
    versions.electron = "29.0.0";
    process.env.BETTER_SQLITE3_ALLOW_ELECTRON = "1";
    const module = await import("../../src/helpers/embeddings.ts");
    expect(module.shouldLoadBetterSqlite3()).toBe(true);
  });

  it("allows loading outside Electron by default", async () => {
    delete versions.electron;
    const module = await import("../../src/helpers/embeddings.ts");
    expect(module.shouldLoadBetterSqlite3()).toBe(true);
  });
});
