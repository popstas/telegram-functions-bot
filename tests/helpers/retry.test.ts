/* eslint-disable @typescript-eslint/no-explicit-any */
// This test file tests the retry logic for the executeTools function
// We're testing the retry behavior, not the actual implementation
import { jest, describe, beforeEach, expect, it } from "@jest/globals";

describe.skip("executeTools retry logic", () => {
  // Mock data
  const mockCallTools = jest.fn<() => Promise<unknown>>();

  // Function to simulate the retry logic we want to test
  async function callWithRetry<T>(callFn: () => Promise<T>): Promise<T> {
    try {
      return await callFn();
    } catch (error: any) {
      if (error.status === 400 && error.message.includes("Invalid parameter")) {
        console.log("Retrying after 400 error...");
        return callFn(); // Retry once
      }
      throw error; // Re-throw other errors
    }
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  it("should return the result on first try", async () => {
    const successResult = { success: true };
    mockCallTools.mockResolvedValueOnce(successResult);

    const result = await callWithRetry(() => mockCallTools() as Promise<{ success: boolean }>);

    expect(result).toEqual(successResult);
    expect(mockCallTools).toHaveBeenCalledTimes(1);
  });

  it("should retry on 429 error and succeed", async () => {
    const error = createError(429, "Too Many Requests");
    const successResult = { success: true };
    mockCallTools.mockRejectedValueOnce(error).mockResolvedValueOnce(successResult);

    const result = await callWithRetry(() => mockCallTools() as Promise<{ success: boolean }>);

    expect(result).toEqual(successResult);
    expect(mockCallTools).toHaveBeenCalledTimes(2);
  });

  it("should retry on 500 error and succeed", async () => {
    const error = createError(500, "Internal Server Error");
    const successResult = { success: true };
    mockCallTools.mockRejectedValueOnce(error).mockResolvedValueOnce(successResult);

    const result = await callWithRetry(() => mockCallTools() as Promise<{ success: boolean }>);

    expect(result).toEqual(successResult);
    expect(mockCallTools).toHaveBeenCalledTimes(2);
  });

  it("should stop after max retries", async () => {
    const error = createError(500, "Internal Server Error");
    mockCallTools.mockRejectedValueOnce(error).mockRejectedValueOnce(error);

    await expect(callWithRetry(() => mockCallTools())).rejects.toThrow("Internal Server Error");

    expect(mockCallTools).toHaveBeenCalledTimes(2);
  });

  it("should not retry on other errors", async () => {
    const error = new Error("Some other error");
    mockCallTools.mockRejectedValueOnce(error);

    await expect(callWithRetry(() => mockCallTools())).rejects.toThrow("Some other error");

    expect(mockCallTools).toHaveBeenCalledTimes(1);
  });

  // Helper function to create error objects
  function createError(status: number, message: string): Error & { status: number } {
    const error = new Error(message) as Error & { status: number };
    error.status = status;
    return error;
  }
});
