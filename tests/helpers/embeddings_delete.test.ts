import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import fs from "node:fs/promises";
import path from "node:path";
import type { ConfigChatType } from "../../src/types";

const mockEmbeddings: Record<string, number[]> = {
  existing: [0, 0, 0],
  far: [100, 0, 0],
};

jest.unstable_mockModule("../../src/helpers/useApi.ts", () => ({
  useApi: () => ({
    embeddings: {
      create: async ({ input }: { input: string }) => ({
        data: [
          { embedding: mockEmbeddings[input as keyof typeof mockEmbeddings] },
        ],
      }),
    },
  }),
}));

let embeddings: typeof import("../../src/helpers/embeddings.ts");
const dbPath = path.join(process.cwd(), "emb_test.sqlite");

function chat(): ConfigChatType {
  return {
    id: 1,
    name: "c",
    completionParams: {},
    chatParams: { vector_memory: true } as any,
    toolParams: { vector_memory: { dbPath, dimension: 3 } },
  } as ConfigChatType;
}

beforeEach(async () => {
  jest.resetModules();
  await fs.rm(dbPath, { force: true });
  embeddings = await import("../../src/helpers/embeddings.ts");
});

afterEach(async () => {
  embeddings.closeDb(dbPath);
  await fs.rm(dbPath, { force: true });
});

describe("deleteEmbedding max distance", () => {
  it("respects deleteMaxDistance", async () => {
    const chatConfig = chat();
    await embeddings.saveEmbedding({
      text: "existing",
      metadata: {},
      chat: chatConfig,
    });

    let res = await embeddings.deleteEmbedding({
      query: "far",
      limit: 5,
      chat: chatConfig,
    });
    expect(res).toHaveLength(0);

    chatConfig.toolParams!.vector_memory!.deleteMaxDistance = 200;
    res = await embeddings.deleteEmbedding({
      query: "far",
      limit: 5,
      chat: chatConfig,
    });
    expect(res).toHaveLength(1);
  });
});
