import type { Sql } from "postgres"
import type { MigrationDriver } from "./driver.types.js"
import { toPostgresParams } from "../util/sql-runner.ts"

export const fromPostgresJs = (sql: Sql): MigrationDriver => ({
  exec: async (s: string, params: unknown[] = []): Promise<void> => {
    if (params.length === 0) {
      await sql.unsafe(s)
    } else {
      await sql.unsafe(toPostgresParams(s), params as Parameters<typeof sql.unsafe>[1])
    }
  },
  query: async <T = Record<string, unknown>>(s: string, params: unknown[] = []): Promise<T[]> => {
    const query = params.length === 0 ? s : toPostgresParams(s)
    return sql.unsafe(query, params as Parameters<typeof sql.unsafe>[1]) as Promise<T[]>
  }
})
