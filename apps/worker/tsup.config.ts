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
  // The Claude subscription engine loads the Agent SDK (and its Claude Code
  // binary) on first use, from node_modules: never bundled, and not in the
  // image (a subscription login lives on the owner's own machine).
  external: ['@anthropic-ai/claude-agent-sdk'],
});
