import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    pool: "forks",
    testTimeout: 30_000,
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
  },
})
