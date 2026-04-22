export interface MigrationDriver {
  /** Execute raw SQL — may contain multiple statements. No parameterization. Used for migration files. */
  exec(sql: string): Promise<void>
  /** Execute a parameterized query. Returns typed rows. Used for db_evolutions ledger operations. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}
