/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  extensionsToTreatAsEsm: ['.ts'],
  testMatch: ['**/__tests__/**/*.+(ts|tsx|js)', '**/?(*.)+(spec|test).+(ts|tsx|js)'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
        isolatedModules: true,
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(langfuse|@langfuse)/)',
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setupTests.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: [
    'json-summary',
    'lcov',
    'text',
    'text-summary'
  ],
};

export default config;