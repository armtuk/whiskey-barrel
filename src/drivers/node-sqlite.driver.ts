import type { DatabaseSync } from "node:sqlite"
import type { MigrationDriver } from "./driver.types.js"

/** Requires Node.js >= 22.13. */
export const fromNodeSqlite = (db: DatabaseSync): MigrationDriver => ({
  exec: async (sql: string): Promise<void> => {
    db.exec(sql)
  },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const stmt = db.prepare(sql)
    if (/^\s*SELECT\b/i.test(sql)) return stmt.all(...(params as Parameters<typeof stmt.all>)) as T[]
    stmt.run(...(params as Parameters<typeof stmt.run>))
    return []
  }
})
