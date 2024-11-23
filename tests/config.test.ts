import { readConfig, writeConfig, generateConfig } from '../src/config.ts';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

jest.mock('fs');
jest.mock('js-yaml');

describe('readConfig', () => {
  const originalConsole = { ...console };
  
  beforeAll(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
  });

  afterAll(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
  });
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate and write a new config if the file does not exist', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    const mockConfig = generateConfig();
    (yaml.dump as jest.Mock).mockReturnValue('mockYaml');
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

    const config = readConfig('testConfig.yml');

    expect(fs.existsSync).toHaveBeenCalledWith('testConfig.yml');
    expect(yaml.dump).toHaveBeenCalledWith(mockConfig, expect.any(Object));
    expect(fs.writeFileSync).toHaveBeenCalledWith('testConfig.yml', 'mockYaml');
    expect(config).toEqual(mockConfig);
  });

  it('should read and return the config if the file exists', () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    const mockConfig = generateConfig();
    (fs.readFileSync as jest.Mock).mockReturnValue('mockYaml');
    (yaml.load as jest.Mock).mockReturnValue(mockConfig);

    const config = readConfig('testConfig.yml');

    expect(fs.existsSync).toHaveBeenCalledWith('testConfig.yml');
    expect(fs.readFileSync).toHaveBeenCalledWith('testConfig.yml', 'utf8');
    expect(yaml.load).toHaveBeenCalledWith('mockYaml');
    expect(config).toEqual(mockConfig);
  });
});

describe('writeConfig', () => {
  const originalConsole = { ...console };
  
  beforeAll(() => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
  });

  afterAll(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should write the config to the specified file', () => {
    const mockConfig = generateConfig();
    (yaml.dump as jest.Mock).mockReturnValue('mockYaml');
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});

    const config = writeConfig('testConfig.yml', mockConfig);

    expect(yaml.dump).toHaveBeenCalledWith(mockConfig, expect.any(Object));
    expect(fs.writeFileSync).toHaveBeenCalledWith('testConfig.yml', 'mockYaml');
    expect(config).toEqual(mockConfig);
  });

  it('should handle errors during writing', () => {
    const mockConfig = generateConfig();
    const mockError = new Error('mockError');
    (yaml.dump as jest.Mock).mockImplementation(() => {
      throw mockError;
    });
    console.error = jest.fn();

    const config = writeConfig('testConfig.yml', mockConfig);

    expect(yaml.dump).toHaveBeenCalledWith(mockConfig, expect.any(Object));
    expect(console.error).toHaveBeenCalledWith('Error in writeConfig(): ', mockError);
    expect(config).toEqual(mockConfig);
  });
});
