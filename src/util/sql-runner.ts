import { Context, Effect } from "effect"
import type { MigrationDriver } from "../drivers/driver.types.ts"
import type { UnknownException } from "effect/Cause"

export class SqlRunner extends Context.Tag("SqlRunner")<SqlRunner, {
  exec(s: string, params?: unknown[]): Effect.Effect<void, UnknownException, never>
  query<T>(s: string, params?: unknown[]): Effect.Effect<T[], UnknownException, never>
}>() { }

export const fromMigrationDriver = (driver: MigrationDriver) => ({
  exec(s: string, params?: unknown[]): Effect.Effect<void, UnknownException, never> {
    return Effect.tryPromise(() => driver.exec(s, params))
  },

  query<T = Record<string, unknown>>(s: string, params?: unknown[]): Effect.Effect<T[], UnknownException, never> {
    return Effect.tryPromise(() => driver.query<T>(s, params))
  }
})

export const toPostgresParams = (sql: string): string => {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}
