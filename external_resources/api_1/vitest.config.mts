import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    mockReset: true,
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 10000,
  },
});
