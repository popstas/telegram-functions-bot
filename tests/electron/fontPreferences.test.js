import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_FONT_SIZE,
  FONT_SIZE_OPTIONS,
  isFontSizeOption,
  normalizeFontSizePreference,
} from "../../electron/fontPreferences.js";

describe("fontPreferences", () => {
  test("normalizeFontSizePreference falls back to default for invalid input", () => {
    expect(normalizeFontSizePreference(undefined)).toBe(DEFAULT_FONT_SIZE);
    expect(normalizeFontSizePreference(null)).toBe(DEFAULT_FONT_SIZE);
    expect(normalizeFontSizePreference(123)).toBe(DEFAULT_FONT_SIZE);
    expect(normalizeFontSizePreference("extra-large")).toBe(DEFAULT_FONT_SIZE);
  });

  test("normalizeFontSizePreference accepts known values", () => {
    FONT_SIZE_OPTIONS.forEach((option) => {
      expect(normalizeFontSizePreference(option)).toBe(option);
      expect(normalizeFontSizePreference(option.toUpperCase())).toBe(option);
      expect(normalizeFontSizePreference(`  ${option}  `)).toBe(option);
    });
  });

  test("isFontSizeOption only returns true for supported options", () => {
    FONT_SIZE_OPTIONS.forEach((option) => {
      expect(isFontSizeOption(option)).toBe(true);
    });
    ["", "INVALID", "medium-large", 42].forEach((value) => {
      expect(isFontSizeOption(value)).toBe(false);
    });
  });
});
