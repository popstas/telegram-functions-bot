import { describe, it, expect } from "@jest/globals";
import { buildMessages } from "../../src/helpers/gpt";
import { OpenAI } from "openai";

describe("buildMessages", () => {
  it("limits history and removes leading tool message", async () => {
    const history: OpenAI.ChatCompletionMessageParam[] = [
      { role: "tool", content: "t" },
      ...Array.from({ length: 8 }).map((_, i) => ({
        role: "user",
        content: String(i),
      })),
    ];

    const res = await buildMessages("sys", history);
    expect(res[0]).toEqual({ role: "system", content: "sys" });
    expect(res[1].role).toBe("user");
    expect(res.length).toBeLessThanOrEqual(8); // limit + system
  });

  it("sanitizes user name", async () => {
    const history: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content: "hi", name: "John / Doe" },
    ];

    const res = await buildMessages("sys", history);
    expect(res[1].name).toBe("JohnDoe");
  });
});
