import { jest, describe, it, expect, afterEach } from "@jest/globals";
const { withChatAction } = await import("../../src/telegram/chatAction.ts");

describe("withChatAction (grammY phase)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("sends the action immediately and every 4s until fn settles", async () => {
    jest.useFakeTimers();
    const sendChatAction = jest.fn(async () => true);
    const ctx = { api: { sendChatAction }, chat: { id: 9 } };
    let release!: (v: string) => void;
    const p = withChatAction(ctx, "typing", () => new Promise<string>((r) => (release = r)));
    await Promise.resolve();
    expect(sendChatAction).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(8000);
    expect(sendChatAction).toHaveBeenCalledTimes(3);
    release("done");
    await expect(p).resolves.toBe("done");
    await jest.advanceTimersByTimeAsync(8000);
    expect(sendChatAction).toHaveBeenCalledTimes(3); // stopped after fn settled
    expect(sendChatAction).toHaveBeenLastCalledWith(9, "typing", undefined);
  });

  it("passes business_connection_id when the context carries one", async () => {
    const sendChatAction = jest.fn(async () => true);
    const ctx = { api: { sendChatAction }, chat: { id: 7 }, businessConnectionId: "b1" };
    const res = await withChatAction(ctx, "typing", async () => 5);
    expect(res).toBe(5);
    expect(sendChatAction).toHaveBeenCalledWith(7, "typing", {
      business_connection_id: "b1",
    });
  });

  it("runs fn directly for synthetic contexts (no api / noSendTelegram)", async () => {
    expect(await withChatAction({}, "typing", async () => 1)).toBe(1);
    const sendChatAction = jest.fn();
    await withChatAction(
      { api: { sendChatAction }, chat: { id: 1 }, noSendTelegram: true },
      "typing",
      async () => 2,
    );
    expect(sendChatAction).not.toHaveBeenCalled();
  });

  it("propagates fn rejection and still clears the interval", async () => {
    jest.useFakeTimers();
    const sendChatAction = jest.fn(async () => true);
    const ctx = { api: { sendChatAction }, chat: { id: 3 } };
    const p = withChatAction(ctx, "typing", async () => {
      throw new Error("boom");
    });
    await expect(p).rejects.toThrow("boom");
    const callsAfterReject = sendChatAction.mock.calls.length;
    await jest.advanceTimersByTimeAsync(8000);
    expect(sendChatAction).toHaveBeenCalledTimes(callsAfterReject); // interval cleared
  });
});
