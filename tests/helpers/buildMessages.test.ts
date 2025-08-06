import { describe, it, expect } from "@jest/globals";
import { buildMessages } from "../../src/helpers/gpt.ts";
import { OpenAI } from "openai";

describe("buildMessages", () => {
  it("limits history and removes leading tool message", async () => {
    const history: OpenAI.ChatCompletionMessageParam[] = [
      { role: "tool", content: "t" },
      ...Array.from({ length: 25 }).map((_, i) => ({
        role: "user",
        content: String(i),
      })),
    ];

    const res = await buildMessages("sys", history);
    expect(res[0]).toEqual({ role: "system", content: "sys" });
    expect(res[1].role).toBe("user");
    expect(res.length).toBeLessThanOrEqual(21); // limit + system
  });

  it("removes tool messages without preceding assistant", async () => {
    const history: OpenAI.ChatCompletionMessageParam[] = [
      { role: "assistant", content: "hi" },
      { role: "tool", content: "result", tool_call_id: "x" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "y",
            type: "function",
            function: { name: "f", arguments: "{}" },
          },
        ],
      } as OpenAI.ChatCompletionAssistantMessageParam,
      { role: "tool", content: "ok", tool_call_id: "y" },
    ];

    const res = await buildMessages("sys", history);
    expect(res.map((m) => m.role)).toEqual([
      "system",
      "assistant",
      "assistant",
      "tool",
    ]);
  });

  it("sanitizes user name", async () => {
    const history: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content: "hi", name: "John / Doe" },
    ];

    const res = await buildMessages("sys", history);
    expect(res[1].name).toBe("JohnDoe");
  });
});
