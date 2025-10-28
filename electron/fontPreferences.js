export const FONT_SIZE_OPTIONS = ["small", "medium", "large"];
export const DEFAULT_FONT_SIZE = "medium";

export function normalizeFontSizePreference(value) {
  if (typeof value !== "string") {
    return DEFAULT_FONT_SIZE;
  }
  const normalized = value.toLowerCase().trim();
  return FONT_SIZE_OPTIONS.includes(normalized) ? normalized : DEFAULT_FONT_SIZE;
}

export function isFontSizeOption(value) {
  if (typeof value !== "string") {
    return false;
  }
  return FONT_SIZE_OPTIONS.includes(value);
}
