import type Database from "better-sqlite3"
import type { MigrationDriver } from "./driver.types.ts"

export const fromBetterSqlite3 = (db: Database.Database): MigrationDriver => ({
  exec: async (sql: string, params: unknown[] = []): Promise<void> => {
    if (params.length === 0) {
      db.exec(sql)
    } else {
      db.prepare(sql).run(...params)
    }
  },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const stmt = db.prepare(sql)
    if (stmt.reader) return stmt.all(...params) as T[]
    stmt.run(...params)
    return []
  },
  close: async (): Promise<void> => {
    db.close()
  }
})
