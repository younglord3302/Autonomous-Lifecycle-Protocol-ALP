import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    include: [
      'parser/tests/**/*.test.ts',
      'sdk/typescript/test/**/*.test.ts',
      'tests/compliance/**/*.test.ts',
    ],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@alp/parser': resolve('./parser/src/index.ts'),
    },
  },
});
