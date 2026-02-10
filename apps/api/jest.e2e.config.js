/** @type {import('jest').Config} */
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: '.',
    testRegex: '.e2e-spec\\.ts$',
    transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
    },
    testEnvironment: 'node',
    // Testnet ops are slow — allow 5 min per test, 20 min total
    testTimeout: 300_000,
    moduleNameMapper: {
        '^sdk$': '<rootDir>/../../packages/sdk/src/index.ts',
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};
