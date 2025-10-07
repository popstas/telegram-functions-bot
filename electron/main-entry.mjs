import 'tsx/esm';

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'desktop';
}

await import('./main.ts');
