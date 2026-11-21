import { defineConfig } from 'vitest/config';

// Only the eval's own tests: eval/demo-repo/tests belong to the review fixture.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
