import { jest } from "@jest/globals";

// Mock the modules using jest.requireMock
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockWatchFile = jest.fn();
const mockAppendFileSync = jest.fn();
const mockDump = jest.fn();
const mockLoad = jest.fn();

// Mock the modules before importing the module under test
jest.unstable_mockModule("fs", () => ({
  __esModule: true,
  default: {
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    watchFile: mockWatchFile,
    appendFileSync: mockAppendFileSync,
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  watchFile: mockWatchFile,
  appendFileSync: mockAppendFileSync,
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
const { readConfig, writeConfig, generateConfig } = configMod;

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
});

describe("writeConfig", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should write the config to the specified file", () => {
    const mockConfig = generateConfig();
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
});

describe("readConfig agent_name", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("generates agent_name and strips proxy_url", () => {
    mockExistsSync.mockReturnValue(true);
    const cfg = generateConfig();
    cfg.chats.push({ name: "Test Chat" } as any);
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
