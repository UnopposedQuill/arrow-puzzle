// The package ships as ESM ("type": "module"), but tests are transformed to
// CommonJS rather than run through Jest's ESM mode. That mode still needs
// NODE_OPTIONS=--experimental-vm-modules, which cmd.exe cannot set inline, and
// this repo is developed on Windows as well as WSL/macOS. The sources here are
// pure functions with no ESM-only runtime features (no import.meta, no
// top-level await), so the transform is transparent.
//
// The .cjs extension is required: a plain jest.config.js would be parsed as ESM
// because of the package's "type": "module".
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'Node',
        target: 'ES2020',
        strict: true,
        esModuleInterop: true,
      },
    }],
  },
  // NodeNext sources import with an explicit .js extension; strip it so the
  // CommonJS resolver finds the .ts file.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
