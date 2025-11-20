import path from "node:path";

export function sanitizeUrlForScreenshot(url?: string): string {
  if (!url) {
    return "screenshot";
  }

  let normalized = url;
  try {
    const parsed = new URL(url);
    normalized = `${parsed.hostname}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    normalized = url;
  }

  normalized = normalized
    .replace(/(^\w+:|^)\/\//, "")
    .replace(/[^a-z0-9а-яё]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return normalized || "screenshot";
}

export function resolveScreenshotExtension(format?: string): string {
  const normalized = (format || "png").toLowerCase();
  if (normalized === "jpeg") {
    return "jpg";
  }
  if (
    normalized === "jpg" ||
    normalized === "png" ||
    normalized === "webp" ||
    normalized === "gif"
  ) {
    return normalized;
  }
  return "png";
}

export function resolveScreenshotPath(
  basePath: string,
  url: string | undefined,
  extension: string,
): string {
  const sanitized = sanitizeUrlForScreenshot(url);
  const fileName = `${sanitized}.${extension}`;
  return path.resolve(basePath, fileName);
}
