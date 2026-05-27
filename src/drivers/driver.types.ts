export abstract class MigrationDriver {
  abstract exec(sql: string): Promise<void>
  abstract query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}
