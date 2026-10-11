import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.property.test.ts'],
    globals: true,
    testTimeout: 30000, // Longer timeout for property-based tests
  },
});
