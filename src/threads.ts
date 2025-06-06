import { ThreadStateType } from "./types.ts";

const threads = {} as { [key: number]: ThreadStateType };

export function useThreads() {
  return threads;
}
