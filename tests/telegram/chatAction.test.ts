import { describe, it, expect } from "@jest/globals";
const { withChatAction } = await import("../../src/telegram/chatAction.ts");

describe("withChatAction (telegraf phase)", () => {
  it("delegates to ctx.persistentChatAction and returns fn result", async () => {
    const calls: string[] = [];
    const ctx = {
      persistentChatAction: async (action: string, cb: () => Promise<void>) => {
        calls.push(action);
        await cb();
      },
    };
    const res = await withChatAction(ctx, "typing", async () => 42);
    expect(res).toBe(42);
    expect(calls).toEqual(["typing"]);
  });
  it("runs fn directly when ctx has no persistentChatAction (synthetic ctx)", async () => {
    const res = await withChatAction({}, "typing", async () => "ok");
    expect(res).toBe("ok");
  });
  it("propagates fn rejection", async () => {
    await expect(
      withChatAction({}, "typing", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  });
});
