/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.e2e-spec\\.ts$'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^sdk$': '<rootDir>/../../packages/sdk/src/index.ts',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
