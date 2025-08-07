import { jest } from "@jest/globals";
import path from "path";
import { ConfigChatType } from "../src/types.ts";

// Mock the modules using jest.requireMock
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockWatchFile = jest.fn();
const mockWatch = jest.fn();
const mockAppendFileSync = jest.fn();
const mockDump = jest.fn();
const mockLoad = jest.fn();
const mockReaddirSync = jest.fn();
const mockMkdirSync = jest.fn();

// Mock the modules before importing the module under test
jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    watchFile: mockWatchFile,
    watch: mockWatch,
    appendFileSync: mockAppendFileSync,
    readdirSync: mockReaddirSync,
    mkdirSync: mockMkdirSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  watchFile: mockWatchFile,
  watch: mockWatch,
  appendFileSync: mockAppendFileSync,
  readdirSync: mockReaddirSync,
  mkdirSync: mockMkdirSync,
}));

jest.unstable_mockModule("js-yaml", () => ({
  __esModule: true,
  default: {
    dump: mockDump,
    load: mockLoad,
  },
  dump: mockDump,
  load: mockLoad,
}));

// Import the module under test after setting up mocks
const configMod = await import("../src/config.ts");
const {
  readConfig,
  writeConfig,
  generateConfig,
  loadChatsFromDir,
  saveChatsToDir,
} = configMod;

describe("generateConfig", () => {
  it("sets defaults for chat directory fields", () => {
    const cfg = generateConfig();
    expect(cfg.useChatsDir).toBe(false);
    expect(cfg.chatsDir).toBe("data/chats");
  });
});

describe("readConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should generate and write a new config if the file does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    const mockConfig = generateConfig();
    mockDump.mockReturnValue("mockYaml");
    mockWriteFileSync.mockImplementation(() => {});

    const config = readConfig("testConfig.yml");

    expect(mockExistsSync).toHaveBeenCalledWith("testConfig.yml");
    expect(mockDump).toHaveBeenCalledWith(mockConfig, expect.any(Object));
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "testConfig.yml",
      "mockYaml",
    );
    expect(config).toEqual(mockConfig);
  });

  it("should read and return the config if the file exists", () => {
    mockExistsSync.mockReturnValue(true);
    const mockConfig = generateConfig();
    mockReadFileSync.mockReturnValue("mockYaml");
    mockLoad.mockReturnValue(mockConfig);

    const config = readConfig("testConfig.yml");

    expect(mockExistsSync).toHaveBeenCalledWith("testConfig.yml");
    expect(mockReadFileSync).toHaveBeenCalledWith("testConfig.yml", "utf8");
    expect(mockLoad).toHaveBeenCalledWith("mockYaml");
    expect(config).toEqual(mockConfig);
  });

  it("loads chats from directory when useChatsDir enabled", () => {
    mockExistsSync.mockReturnValue(true);
    const cfg = generateConfig();
    cfg.useChatsDir = true;
    cfg.chatsDir = "chats";
    mockReadFileSync
      .mockReturnValueOnce("cfgYaml")
      .mockReturnValueOnce("c1yaml")
      .mockReturnValueOnce("c2yaml");
    const chat1 = { name: "c1", agent_name: "c1" } as ConfigChatType;
    const chat2 = { name: "c2", agent_name: "c2" } as ConfigChatType;
    mockLoad
      .mockReturnValueOnce(cfg)
      .mockReturnValueOnce(chat1)
      .mockReturnValueOnce(chat2);
    mockReaddirSync.mockReturnValue(["c1.yml", "c2.yml"]);

    const res = readConfig("testConfig.yml");

    expect(mockReaddirSync).toHaveBeenCalledWith("chats");
    expect(res.chats).toEqual([chat1, chat2]);
  });
});

describe("writeConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should write the config to the specified file", () => {
    const mockConfig = generateConfig();
    mockExistsSync.mockReturnValue(false);
    mockDump.mockReturnValue("mockYaml");
    mockWriteFileSync.mockImplementation(() => {});

    const config = writeConfig("testConfig.yml", mockConfig);

    expect(mockDump).toHaveBeenCalledWith(mockConfig, expect.any(Object));
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      "testConfig.yml",
      "mockYaml",
    );
    expect(config).toEqual(mockConfig);
  });

  it("should handle errors during writing", () => {
    const mockConfig = generateConfig();
    const mockError = new Error("mockError");
    mockDump.mockImplementation(() => {
      throw mockError;
    });
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const config = writeConfig("testConfig.yml", mockConfig);

    expect(mockDump).toHaveBeenCalledWith(mockConfig, expect.any(Object));
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error in writeConfig(): ",
      mockError,
    );
    expect(config).toEqual(mockConfig);

    // Clean up
    consoleErrorSpy.mockRestore();
  });

  it("saves chats to directory when useChatsDir enabled", () => {
    const cfg = generateConfig();
    cfg.useChatsDir = true;
    cfg.chatsDir = "chats";
    cfg.chats = [
      {
        name: "c1",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
    ];
    mockDump.mockReturnValueOnce("chatYaml").mockReturnValueOnce("mainYaml");
    mockExistsSync.mockReturnValue(true);

    const res = writeConfig("cfg.yml", cfg);

    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join("chats", "c1.yml"),
      "chatYaml",
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith("cfg.yml", "mainYaml");
    const mainDumpCall = mockDump.mock.calls.find((c) => c[0].auth);
    expect(mainDumpCall[0].chats).toBeUndefined();
    expect(res).toEqual(cfg);
  });

  it("skips writing when config content unchanged", () => {
    const cfg = generateConfig();
    mockDump.mockReturnValueOnce("same");
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("same");
    writeConfig("cfg.yml", cfg);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("loadChatsFromDir", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reads yaml files from directory", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["a.yml", "b.yaml", "c.txt"]);
    mockReadFileSync.mockReturnValueOnce("ayaml").mockReturnValueOnce("byaml");
    const chatA = { name: "a" } as ConfigChatType;
    const chatB = { name: "b" } as ConfigChatType;
    mockLoad.mockReturnValueOnce(chatA).mockReturnValueOnce(chatB);
    const res = loadChatsFromDir("dir");
    expect(res).toEqual([chatA, chatB]);
    expect(mockReadFileSync).toHaveBeenCalledWith(
      path.join("dir", "a.yml"),
      "utf8",
    );
    expect(mockReadFileSync).toHaveBeenCalledWith(
      path.join("dir", "b.yaml"),
      "utf8",
    );
  });

  it("returns empty array when directory missing", () => {
    mockExistsSync.mockReturnValue(false);
    const res = loadChatsFromDir("dir");
    expect(res).toEqual([]);
    expect(mockReaddirSync).not.toHaveBeenCalled();
  });
});

describe("saveChatsToDir", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("writes chats to files", () => {
    mockExistsSync.mockReturnValue(false);
    const chats = [
      {
        name: "a",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
      {
        name: "b",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
    ];
    mockDump.mockReturnValueOnce("ayaml").mockReturnValueOnce("byaml");
    saveChatsToDir("dir", chats);
    expect(mockMkdirSync).toHaveBeenCalledWith("dir", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join("dir", "a.yml"),
      "ayaml",
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join("dir", "b.yml"),
      "byaml",
    );
  });

  it("skips write when chat file unchanged", () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("ayaml");
    mockDump.mockReturnValue("ayaml");
    const chats = [
      {
        name: "a",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
    ];
    saveChatsToDir("dir", chats);
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it("uses private_<username>.yml for private chats", () => {
    mockExistsSync.mockReturnValue(false);
    const chats = [
      {
        name: "Private alice",
        username: "alice",
        completionParams: {},
        chatParams: {},
        toolParams: {},
      } as ConfigChatType,
    ];
    mockDump.mockReturnValueOnce("ayaml");
    saveChatsToDir("dir", chats);
    expect(mockMkdirSync).toHaveBeenCalledWith("dir", { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      path.join("dir", "private_alice.yml"),
      "ayaml",
    );
  });
});

describe("readConfig agent_name", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates agent_name and strips proxy_url", () => {
    mockExistsSync.mockReturnValue(true);
    const cfg = generateConfig();
    cfg.chats.push({ name: "Test Chat" } as ConfigChatType);
    mockReadFileSync.mockReturnValue("yaml content");
    mockLoad.mockReturnValue(JSON.parse(JSON.stringify(cfg)));
    const result = readConfig("testConfig.yml");

    expect(result.auth.proxy_url).toBeUndefined();
    const newChat = result.chats[result.chats.length - 1];
    expect(newChat.agent_name).toBe("test_chat");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("agent_name not set for chat Test Chat"),
    );
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining("Config modified"),
    );
  });
});

describe("checkConfigSchema", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("warns about extra fields", () => {
    mockExistsSync.mockReturnValue(true);
    const cfg = generateConfig();
    (cfg as unknown as Record<string, unknown>).extra = 1;
    mockReadFileSync.mockReturnValue("yaml");
    mockLoad.mockReturnValue(cfg);

    readConfig("testConfig.yml");
    expect(console.warn).toHaveBeenCalled();
  });

  it("warns about deprecated showTelegramNames", () => {
    mockExistsSync.mockReturnValue(true);
    const cfg = generateConfig();
    cfg.chats[0].chatParams = { showTelegramNames: true } as unknown as Record<
      string,
      unknown
    >;
    mockReadFileSync.mockReturnValue("yaml");
    mockLoad.mockReturnValue(cfg);

    readConfig("testConfig.yml");
    expect(console.warn).toHaveBeenCalled();
  });
});
