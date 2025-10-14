import { fileURLToPath } from 'node:url';

const shouldEnableTsLoader = process.defaultApp ?? process.env.NODE_ENV === 'desktop';
const tsxImportFlag = '--import tsx/esm';

if (shouldEnableTsLoader && !process.env.NODE_OPTIONS?.includes(tsxImportFlag)) {
  process.env.NODE_OPTIONS = process.env.NODE_OPTIONS
    ? `${process.env.NODE_OPTIONS} ${tsxImportFlag}`
    : tsxImportFlag;
}

if (shouldEnableTsLoader) {
  if (!process.env.TSX_TSCONFIG_PATH) {
    const runtimeConfigPath = fileURLToPath(new URL('../tsconfig.desktop-runtime.json', import.meta.url));
    process.env.TSX_TSCONFIG_PATH = runtimeConfigPath;
  }
  await import('tsx/esm');
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'desktop';
}

await import('./main.ts');
