import type { Sql } from "postgres"
import type { MigrationDriver } from "./driver.types.js"

export const fromPostgresJs = (sql: Sql): MigrationDriver => ({
  exec: async (s: string): Promise<void> => {
    await sql.unsafe(s)
  },
  query: async <T = Record<string, unknown>>(s: string, params: unknown[] = []): Promise<T[]> =>
    sql.unsafe(s, params as Parameters<typeof sql.unsafe>[1]) as Promise<T[]>
})
