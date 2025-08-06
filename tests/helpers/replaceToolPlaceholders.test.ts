import { jest } from "@jest/globals";
import {
  replaceToolPlaceholders,
  __clearToolCache,
} from "../../src/helpers/placeholders.ts";
import {
  ConfigChatType,
  ThreadStateType,
  ChatToolType,
} from "../../src/types.ts";

const chatConfig: ConfigChatType = {
  name: "test",
  completionParams: {},
  chatParams: {},
  toolParams: {},
};

const thread: ThreadStateType = {
  id: 1,
  msgs: [],
  messages: [],
  completionParams: {},
};

const mockFn = jest.fn(async () => ({ content: "OK" }));
const chatTools: ChatToolType[] = [
  {
    name: "echo",
    module: {
      description: "",
      call: jest.fn(() => ({
        functions: {
          get: () => mockFn,
          toolSpecs: { type: "function", function: { name: "echo" } },
        },
      })),
    },
  },
];

describe("replaceToolPlaceholders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __clearToolCache();
  });

  it("replaces tool placeholder with tool result", async () => {
    const text = 'Status: {tool:echo({"a":1})}';
    const res = await replaceToolPlaceholders(
      text,
      chatTools,
      chatConfig,
      thread,
    );
    expect(res).toBe("Status: OK");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it("caches tool result", async () => {
    const text = 'Status: {tool:echo({"a":1})}';
    const res1 = await replaceToolPlaceholders(
      text,
      chatTools,
      chatConfig,
      thread,
      3600,
    );
    const res2 = await replaceToolPlaceholders(
      text,
      chatTools,
      chatConfig,
      thread,
      3600,
    );
    expect(res1).toBe("Status: OK");
    expect(res2).toBe("Status: OK");
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
