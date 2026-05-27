import type { Sql } from "postgres"
import { toPostgresParams } from "../util/sql-runner.ts"
import type { MigrationDriver } from "./driver.types.js"

export const fromPostgresJs = (sql: Sql): MigrationDriver => ({
  exec: async (s: string): Promise<void> => {
    await sql.unsafe(s)
  },
  query: async <T = Record<string, unknown>>(s: string, params: unknown[] = []): Promise<T[]> => {
    const query = params.length === 0 ? s : toPostgresParams(s)
    return sql.unsafe(query, params as Parameters<typeof sql.unsafe>[1]) as Promise<T[]>
  }
})
