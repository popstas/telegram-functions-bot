import { GrammyError } from "grammy";

export function getRetryAfterMs(err: unknown): number | undefined {
  if (
    err instanceof GrammyError &&
    err.error_code === 429 &&
    err.parameters?.retry_after
  ) {
    return err.parameters.retry_after * 1000;
  }
  return undefined;
}

export function isBlockedByUser(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 403;
}

export function isInvalidToken(err: unknown): boolean {
  return err instanceof GrammyError && err.error_code === 401;
}

export function getErrorDescription(err: unknown): string {
  if (err instanceof GrammyError) return err.description;
  if (err instanceof Error) return err.message;
  return String(err);
}
