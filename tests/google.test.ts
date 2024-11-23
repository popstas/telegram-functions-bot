import { getUserGoogleCreds, saveUserGoogleCreds, loadGoogleCreds } from '../src/helpers/google';
import * as fs from 'fs';

jest.mock('fs');

const mockExit = jest.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
  console.log(`Mock exit with code: ${code}`);
  return undefined as never;
});

beforeAll(() => {
  mockExit.mockClear();
});

afterAll(() => {
  mockExit.mockRestore();
});

describe('Google API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserGoogleCreds', () => {
    it('should return undefined if no user_id is provided', () => {
      const creds = getUserGoogleCreds();
      expect(creds).toBeUndefined();
    });

    it('should return user credentials if user_id is provided', () => {
      const mockCreds = { 123: { access_token: 'mockToken' } };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockCreds));

      const creds = getUserGoogleCreds(123);
      expect(creds).toEqual({ access_token: 'mockToken' });
    });

    it('should return undefined if user credentials do not exist', () => {
      const mockCreds = { 123: { access_token: 'mockToken' } };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockCreds));

      const creds = getUserGoogleCreds(456);
      expect(creds).toBeUndefined();
    });
  });

  describe('saveUserGoogleCreds', () => {
    it('should save user credentials if user_id and creds are provided', () => {
      const mockCreds = { access_token: 'mockToken' };
      const mockExistingCreds = { 123: { access_token: 'existingToken' } };
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockExistingCreds));
      (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

      saveUserGoogleCreds(mockCreds, 456);

      const expectedCreds = {
        123: { access_token: 'existingToken' },
        456: { access_token: 'mockToken' },
      };
      expect(fs.writeFileSync).toHaveBeenCalledWith('data/creds.json', JSON.stringify(expectedCreds, null, 2), 'utf-8');
    });

    it('should not save credentials if no user_id is provided', () => {
      console.error = jest.fn();

      saveUserGoogleCreds({ access_token: 'mockToken' });

      expect(console.error).toHaveBeenCalledWith('No user_id to save creds');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should not save credentials if no creds are provided', () => {
      console.error = jest.fn();

      saveUserGoogleCreds(null, 123);

      expect(console.error).toHaveBeenCalledWith('No creds to save');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });
});
