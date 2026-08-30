import { jest, beforeAll, afterAll } from "@jest/globals";
import { GrammyError } from "grammy";

export function makeGrammyError(
  error_code: number,
  description = "",
  parameters: Record<string, unknown> = {},
) {
  return new GrammyError(
    `Call to method failed! (${error_code}: ${description})`,
    { ok: false, error_code, description, parameters } as never,
    "sendMessage",
    {},
  );
}

export const mockConsole = () => {
  const originalConsole = { ...console };

  beforeAll(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
  });

  afterAll(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
  });
};
