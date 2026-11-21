import { defineConfig } from 'tsup';

// Bundles the worker and the @revo/* workspace packages (shipped as TS source)
// into dist/; npm dependencies stay external and are installed in the image.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@revo\//],
});
