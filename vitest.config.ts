/**
 * vitest projects — tiered tests per `testing-infrastructure.md`.
 *
 *   unit         pure functions, mocks. No mongo, no network.        10s
 *   integration  mongo-memory-server + Fastify app.inject.            30s
 *   e2e          live external APIs (gated by env keys).             120s
 */

import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const aliasMap = {
  '#config': resolve(__dirname, './src/config'),
  '#shared': resolve(__dirname, './src/shared'),
  '#resources': resolve(__dirname, './src/resources'),
  '#plugins': resolve(__dirname, './src/plugins'),
};

export default defineConfig({
  resolve: { alias: aliasMap },
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          testTimeout: 10_000,
          hookTimeout: 10_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 30_000,
          // Mongoose model registry is global; parallel forks cause
          // `OverwriteModelError` storms. Single fork keeps state coherent.
          // Vitest 4 moved poolOptions up to top-level project options.
          pool: 'forks',
          fileParallelism: false,
        },
      },
    ],
  },
});
