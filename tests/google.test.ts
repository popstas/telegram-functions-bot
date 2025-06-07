import { jest } from "@jest/globals";
import {
  getUserGoogleCreds,
  saveUserGoogleCreds,
} from "../src/helpers/google.ts";

// Create manual mocks for fs functions
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
const mockWriteFileSync = jest.fn();

// Mock the fs module with our manual mocks
jest.mock("fs", () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  writeFileSync: mockWriteFileSync,
  constants: {
    F_OK: 0,
    W_OK: 1,
    R_OK: 2,
  },
}));

jest.mock("fs");

// Create a mock for readConfig
const mockReadConfig = jest.fn();

// Mock the config module with the mock function
jest.mock("../src/config.ts", () => ({
  __esModule: true,
  readConfig: mockReadConfig,
  generateConfig: jest.fn().mockReturnValue({
    auth: {
      bot_token: "test-bot-token",
      chatgpt_api_key: "test-api-key",
      google_service_account: {
        private_key: "test-key",
      },
    },
  }),
}));

const originalConsole = { ...console };
const mockExit = jest
  .spyOn(process, "exit")
  .mockImplementation(() => undefined as never);

beforeEach(() => {
  // Reset all mocks before each test
  jest.clearAllMocks();

  // Set up the default mock implementation for readConfig
  mockReadConfig.mockReturnValue({
    auth: {
      bot_token: "test-bot-token",
      chatgpt_api_key: "test-api-key",
      google_service_account: {
        private_key: "test-key",
      },
    },
    users: {},
  });
});

beforeAll(() => {
  console.log = jest.fn();
  console.error = jest.fn();
  console.warn = jest.fn();
  console.info = jest.fn();
  mockExit.mockClear();
});

afterAll(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
  mockExit.mockRestore();
});

describe.skip("Google API Integration Tests", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("getUserGoogleCreds", () => {
    beforeEach(() => {
      // Reset all mocks before each test
      jest.clearAllMocks();

      // Set up the default mock implementation for readConfig
      mockReadConfig.mockReturnValue({
        auth: {
          bot_token: "test-bot-token",
          chatgpt_api_key: "test-api-key",
          google_service_account: {
            private_key: "test-key",
          },
        },
        users: {},
      });

      // Default mock implementations for fs functions
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));

      // Mock console.error
      console.error = jest.fn();
    });

    afterEach(() => {
      // Reset all mocks after each test
      jest.clearAllMocks();
    });

    it("should return undefined if no user_id is provided", () => {
      const creds = getUserGoogleCreds();
      expect(creds).toBeUndefined();
    });

    it("should return user credentials if user_id is provided", () => {
      const userId = 123;
      const mockCreds = { [userId]: { access_token: "mockToken" } };
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(mockCreds));

      const creds = getUserGoogleCreds(userId);
      expect(creds).toEqual(mockCreds[userId]);
      expect(mockExistsSync).toHaveBeenCalledWith(
        expect.stringContaining("google-creds.json"),
      );
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining("google-creds.json"),
        "utf-8",
      );
    });

    it("should return undefined if user credentials do not exist", () => {
      const existingUserId = 123;
      const nonExistentUserId = 456;
      const mockCreds = { [existingUserId]: { access_token: "mockToken" } };
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(mockCreds));

      const creds = getUserGoogleCreds(nonExistentUserId);
      expect(creds).toBeUndefined();
    });
  });

  describe("saveUserGoogleCreds", () => {
    it("should save user credentials if user_id and creds are provided", () => {
      const userId = 123;
      const mockCreds = { access_token: "mockToken" };
      const mockExistingCreds = { [userId]: { access_token: "existingToken" } };
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(mockExistingCreds));

      saveUserGoogleCreds(userId, mockCreds);

      expect(mockExistsSync).toHaveBeenCalledWith(
        expect.stringContaining("google-creds.json"),
      );
      expect(mockReadFileSync).toHaveBeenCalledWith(
        expect.stringContaining("google-creds.json"),
        "utf-8",
      );
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining("google-creds.json"),
        JSON.stringify({ ...mockExistingCreds, [userId]: mockCreds }, null, 2),
        "utf-8",
      );
    });

    it("should not save credentials if no user_id is provided", () => {
      // @ts-expect-error - Testing invalid input
      saveUserGoogleCreds(undefined, { access_token: "mockToken" });

      expect(console.error).toHaveBeenCalledWith("No user_id to save creds");
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it("should not save credentials if no creds are provided", () => {
      const userId = 123;
      // @ts-expect-error - Testing invalid input
      saveUserGoogleCreds(userId, undefined);

      expect(console.error).toHaveBeenCalledWith("No creds to save");
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
