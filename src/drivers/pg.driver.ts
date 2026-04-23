import type { Pool } from "pg"
import { splitStatements } from "../evolution.parser.js"
import type { MigrationDriver } from "./driver.types.js"

export const fromPgPool = (pool: Pool): MigrationDriver => ({
  exec: async (sql: string): Promise<void> => {
    const client = await pool.connect()
    try {
      const statements = splitStatements(sql)
      for (const stmt of statements) {
        // biome-ignore lint/performance/noAwaitInLoops: DDL statements must run sequentially
        await client.query(stmt)
      }
    } finally {
      client.release()
    }
  },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    pool.query<Record<string, unknown>>(convertPlaceholders(sql), params).then(r => r.rows as T[])
})

/** Convert `?` placeholders to PostgreSQL `$1, $2, …` style. */
const convertPlaceholders = (sql: string): string => {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}
