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
    setupFiles: ["./vitest.fhv-official-scale.setup.ts"],
    include: ["tests/fhv/official-scale/blocking/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    css: false,
    fileParallelism: false,
    // Full-corpus uses a 125-minute per-test ceiling (plan §13); probe/parity stay shorter.
    testTimeout: 7_500_000,
    hookTimeout: 600_000,
    // Vitest buffers intercepted console output until a test settles. A step killed at the
    // CI timeout therefore emits nothing at all (PR452 run 31011816726: 125 silent minutes).
    // Forward immediately so a long run stays observable while it is still running.
    onConsoleLog(log, type) {
      process[type === "stderr" ? "stderr" : "stdout"].write(log);
      return false;
    },
  },
});
