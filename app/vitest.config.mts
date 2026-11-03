import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    mockReset: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", "dist/**", ".next/**"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 10000,
  },
});
