import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // Hermetic test profile: do not load repository-root `.env.local` during Vitest.
  envDir: path.resolve(__dirname, "tests/env/vitest-hermetic"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  // Skip the project's PostCSS config (Tailwind v4 string-syntax breaks Vite),
  // tests don't render CSS anyway.
  css: {
    postcss: { plugins: [] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    environmentMatchGlobs: [["tests/integration/**", "node"]],
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}", "tests/integration/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    css: false,
    fileParallelism: false,
  },
});
