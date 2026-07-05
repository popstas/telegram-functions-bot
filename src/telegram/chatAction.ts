type PersistentChatActionCtx = {
  persistentChatAction?: (action: string, cb: () => Promise<void>) => Promise<void>;
};

/**
 * Keeps a chat action ("typing", "upload_photo", ...) visible while fn runs.
 * Telegraf phase: delegates to ctx.persistentChatAction when present; synthetic
 * contexts (HTTP/MQTT/business) simply run fn. Re-implemented on grammY in the port.
 */
export async function withChatAction<T>(
  ctx: unknown,
  action: string,
  fn: () => Promise<T>,
): Promise<T> {
  const c = ctx as PersistentChatActionCtx;
  if (typeof c?.persistentChatAction === "function") {
    let result!: T;
    let failed: unknown;
    let didFail = false;
    await c.persistentChatAction(action, async () => {
      try {
        result = await fn();
      } catch (e) {
        didFail = true;
        failed = e;
      }
    });
    if (didFail) throw failed;
    return result;
  }
  return await fn();
}
