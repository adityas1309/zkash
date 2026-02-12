/** @type {import('jest').Config} */
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testRegex: '.e2e-spec\\.ts$',
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testEnvironment: 'node',
    // Testnet ops are slow — allow 10 min per test
    testTimeout: 600_000,
    moduleNameMapper: {
        '^sdk$': '<rootDir>/../../packages/sdk/src/index.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};
