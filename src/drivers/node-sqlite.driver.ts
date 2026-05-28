import type { DatabaseSync } from "node:sqlite"
import type { MigrationDriver } from "./driver.types.ts"

/** Requires Node.js >= 22.13. */
export const fromNodeSqlite = (db: DatabaseSync): MigrationDriver => ({
  exec: async (sql: string, params: unknown[] = []): Promise<void> => {
    if (params.length === 0) {
      db.exec(sql)
    } else {
      db.prepare(sql).run(...(params as Parameters<ReturnType<typeof db.prepare>["run"]>))
    }
  },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const stmt = db.prepare(sql)
    if (/^\s*SELECT\b/i.test(sql)) return stmt.all(...(params as Parameters<typeof stmt.all>)) as T[]
    stmt.run(...(params as Parameters<typeof stmt.run>))
    return []
  },
  close: async (): Promise<void> => {
    db.close()
  }
})
