// Jest exposes beforeEach and afterEach globally
let jestObj: typeof import('@jest/globals').jest;

const originalConsole = { ...console };

beforeEach(async () => {
  if (!jestObj) {
    const mod = await import('@jest/globals');
    jestObj = mod.jest;
  }
  console.log = jestObj.fn();
  console.error = jestObj.fn();
  console.warn = jestObj.fn();
  console.info = jestObj.fn();
});

afterEach(() => {
  console.log = originalConsole.log;
  console.error = originalConsole.error;
  console.warn = originalConsole.warn;
  console.info = originalConsole.info;
});

export {};
