import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/drivers/postgres-js.driver.ts",
    "src/drivers/better-sqlite3.driver.ts",
    "src/drivers/node-sqlite.driver.ts",
    "bin/db-evolutions.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
})
