import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    root: path.resolve('.'),
    setupFiles: ['./test/setup.js'],
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: ['default'],
  },
});
