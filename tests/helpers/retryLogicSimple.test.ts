import { jest } from "@jest/globals";

describe("retryLogicSimple", () => {
  // A simplified version of the retry logic
  async function callWithRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 1,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      // Only retry on 400 errors and if we have retries left
      if (error.status === 400 && maxRetries > 0) {
        return callWithRetry(fn, maxRetries - 1);
      }
      throw error;
    }
  }

  it("should retry once when function fails with 400 error", async () => {
    const mockFn = jest
      .fn()
      .mockRejectedValueOnce({ status: 400, message: "400 Bad Request" })
      .mockResolvedValue("success");

    const result = await callWithRetry(mockFn);

    expect(mockFn).toHaveBeenCalledTimes(2);
    expect(result).toBe("success");
  });

  it("should propagate error if it fails twice with 400 error", async () => {
    const error = { status: 400, message: "400 Bad Request" };
    const mockFn = jest.fn().mockRejectedValue(error);

    await expect(callWithRetry(mockFn)).rejects.toEqual(error);
    expect(mockFn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  it("should not retry for non-400 errors", async () => {
    const error = { status: 500, message: "500 Internal Server Error" };
    const mockFn = jest.fn().mockRejectedValue(error);

    await expect(callWithRetry(mockFn)).rejects.toEqual(error);
    expect(mockFn).toHaveBeenCalledTimes(1); // No retry for non-400 errors
  });

  it("should not retry if maxRetries is 0", async () => {
    const error = { status: 400, message: "400 Bad Request" };
    const mockFn = jest.fn().mockRejectedValue(error);

    await expect(callWithRetry(mockFn, 0)).rejects.toEqual(error);
    expect(mockFn).toHaveBeenCalledTimes(1); // No retry when maxRetries is 0
  });
});
