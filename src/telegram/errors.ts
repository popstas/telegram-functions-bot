type TelegrafErrShape = {
  message?: string;
  response?: {
    error_code?: number;
    statusCode?: number;
    description?: string;
    parameters?: { retry_after?: number };
  };
};

export function getRetryAfterMs(err: unknown): number | undefined {
  const e = err as TelegrafErrShape;
  if (e?.response?.error_code === 429 && e.response.parameters?.retry_after) {
    return e.response.parameters.retry_after * 1000;
  }
  return undefined;
}

export function isBlockedByUser(err: unknown): boolean {
  return (err as TelegrafErrShape)?.response?.error_code === 403;
}

export function isInvalidToken(err: unknown): boolean {
  const e = err as TelegrafErrShape;
  return e?.response?.statusCode === 401 || e?.response?.error_code === 401;
}

export function getErrorDescription(err: unknown): string {
  const e = err as TelegrafErrShape;
  if (e?.response?.description) return e.response.description;
  if (e?.message) return e.message;
  return String(err);
}
