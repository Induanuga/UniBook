module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/__tests__'],
  testMatch: [
    '**/*.test.ts',
    'src/__tests__/nfr/**/*.test.ts'  // Add this line to include NFR tests
  ],
  testTimeout: 15000,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
    '!src/db/migrate.ts',
    '!src/server.ts',
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  globals: {
    'ts-jest': {
      tsconfig: {
        types: ['jest', 'node'],
        lib: ['ES2020'],
      },
    },
  },
};
