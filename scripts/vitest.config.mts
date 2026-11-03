import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    globals: true,
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
