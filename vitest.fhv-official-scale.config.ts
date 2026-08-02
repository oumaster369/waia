import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Isolated Vitest profile for FHV official-scale blocking proofs (Phase 9+).
 * Node environment, extended timeouts, excludes default jsdom/react setup overhead.
 */
export default defineConfig({
  envDir: path.resolve(__dirname, "tests/env/vitest-hermetic"),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/fhv/official-scale/blocking/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    css: false,
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
