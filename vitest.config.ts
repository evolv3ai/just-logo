import { defineConfig } from 'vitest/config';
import viteTsConfigPaths from 'vite-tsconfig-paths';

// Kept separate from vite.config.ts so the test runner does not load the
// TanStack Start and Nitro plugins, which keep a server handle open and stop
// vitest from exiting cleanly.
export default defineConfig({
  plugins: [viteTsConfigPaths({ projects: ['./tsconfig.json'] })],
  test: {
    include: ['cli/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
