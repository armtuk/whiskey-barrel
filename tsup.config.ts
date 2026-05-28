import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: [
      "src/index.ts",
      "src/drivers/postgres-js.driver.ts",
      "src/drivers/better-sqlite3.driver.ts",
      "src/drivers/node-sqlite.driver.ts",
    ],
    format: ["cjs", "esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node18",
  },
  {
    entry: ["bin/db-evolutions.ts"],
    outDir: "dist/bin",
    format: ["cjs", "esm"],
    dts: false,
    sourcemap: true,
    target: "node18",
  }
])
