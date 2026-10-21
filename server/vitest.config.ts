import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
