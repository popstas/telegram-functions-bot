import { jest } from "@jest/globals";
import { mockConsole } from "./testHelpers";

// Mock the modules using jest.requireMock
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();
const mockWatchFile = jest.fn();
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
  },
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  watchFile: mockWatchFile,
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
const { readConfig, writeConfig, generateConfig } = await import(
  "../src/config.ts"
);

describe("readConfig", () => {
  mockConsole();
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
  mockConsole();

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
