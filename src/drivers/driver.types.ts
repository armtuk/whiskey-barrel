export interface MigrationDriver {
  exec(sql: string, params?: unknown[]): Promise<void>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}
