import type Database from "better-sqlite3"
import type { MigrationDriver } from "./driver.types.js"

export const fromBetterSqlite3 = (db: Database.Database): MigrationDriver => ({
  exec: async (sql: string): Promise<void> => {
    db.exec(sql)
  },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const stmt = db.prepare(sql)
    if (stmt.reader) return stmt.all(...params) as T[]
    stmt.run(...params)
    return []
  }
})
