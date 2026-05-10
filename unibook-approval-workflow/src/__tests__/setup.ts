// src/__tests__/setup.ts
// Jest setup — runs after the test framework is installed.
// Silences all console output during tests so the test runner output
// shows only PASS/FAIL lines with no noise.

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'info').mockImplementation(() => undefined);
  jest.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});
