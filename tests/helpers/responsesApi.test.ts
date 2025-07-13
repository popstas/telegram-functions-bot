import { describe, it, expect } from "@jest/globals";
import OpenAI from "openai";
import {
  convertResponsesInput,
  convertResponsesOutput,
} from "../../src/helpers/gpt/responsesApi";

describe("responsesApi helpers", () => {
  it("converts chat params to responses input", () => {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      messages: [{ role: "user", content: "hi", name: "Bob" }],
      model: "m",
      tools: [
        {
          type: "function",
          function: {
            name: "t",
            description: "d",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    };
    const res = convertResponsesInput(params);
    expect(res.input).toEqual([
      { role: "user", content: "hi", type: "message" },
    ]);
    expect(res.tools).toEqual([
      {
        type: "function",
        name: "t",
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    ]);
  });

  it("converts tool messages to responses input", () => {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "x",
              type: "function",
              function: { name: "t", arguments: "{}" },
            },
          ],
        } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam,
        { role: "tool", content: "res", tool_call_id: "x" },
      ],
      model: "m",
    };
    const res = convertResponsesInput(params);
    expect(res.input).toEqual([
      { type: "function_call", name: "t", arguments: "{}", call_id: "x" },
      { type: "function_call_output", call_id: "x", output: "res" },
    ]);
  });

  it("converts responses output with function_call", () => {
    const r: OpenAI.Responses.Response = {
      output_text: "",
      output: [
        { type: "function_call", call_id: "c", name: "t", arguments: "{}" },
      ],
    } as OpenAI.Responses.Response;
    const { res } = convertResponsesOutput(r);
    expect(res.choices[0].message.tool_calls).toEqual([
      {
        id: "c",
        call_id: "c",
        type: "function",
        function: { name: "t", arguments: "{}" },
      },
    ]);
  });

  it("converts responses output with text", () => {
    const r: OpenAI.Responses.Response = {
      output_text: "hello",
    } as OpenAI.Responses.Response;
    const { res } = convertResponsesOutput(r);
    expect(res.choices[0].message.content).toBe("hello");
  });

  it("parses web search details", () => {
    const r: OpenAI.Responses.Response = {
      output_text: "hi",
      output: [
        '{"id":"ws_1","type":"web_search_call","action":{"type":"search","query":"q"}}',
        {
          type: "message",
          content: [
            {
              type: "output_text",
              text: "hi",
              annotations: [
                {
                  type: "url_citation",
                  title: "T",
                  url: "https://u",
                },
              ],
            },
          ],
        },
      ],
    } as unknown as OpenAI.Responses.Response;
    const { res, webSearchDetails } = convertResponsesOutput(r);
    expect(res.choices[0].message.content).toBe("hi");
    expect(webSearchDetails).toContain("Web search:");
    expect(webSearchDetails).toContain("[T](https://u)");
  });
});
