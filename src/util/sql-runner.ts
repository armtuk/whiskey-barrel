import { Context, Effect, Stream } from "effect"
import type { Sql as PgSql } from "postgres"
import type Database from "better-sqlite3"
import type { UnknownException } from "effect/Cause"

export class SqlRunner extends Context.Tag("SqlRunner")<SqlRunner, {
  exec(s: string, params?: unknown[]): Effect.Effect<void, UnknownException, never>
  query<T>(s: string, params?: unknown[]): Effect.Effect<T[], UnknownException, never>
  queryStream<T>(s: string, params?: unknown[]): Stream.Stream<T, UnknownException, never>
}>() { }

export const fromPostgresJs = (sql: PgSql) => ({
  exec(s: string, params?: unknown[]): Effect.Effect<void, UnknownException, never> {
    const query = params && params.length > 0 ? toPostgresParams(s) : s
    return Effect.tryPromise(() =>
      sql.unsafe(query, params as Parameters<typeof sql.unsafe>[1])
    )
  },

  query<T = Record<string, unknown>>(s: string, params: unknown[] = []): Effect.Effect<T[], UnknownException, never> {
    const query = params.length === 0 ? s : toPostgresParams(s)
    return Effect.tryPromise(() =>
      sql.unsafe(query, params as Parameters<typeof sql.unsafe>[1]) as Promise<T[]>
    )
  },

  queryStream<T = Record<string, unknown>>(s: string, params: unknown[] = []): Stream.Stream<T, UnknownException, never> {
    const query = params.length === 0 ? s : toPostgresParams(s)
    return Stream.fromIterableEffect(
      Effect.tryPromise<T[]>(() =>
        sql.unsafe(query, params as Parameters<typeof sql.unsafe>[1]) as Promise<T[]>
      )
    )
  }
})

export const fromBetterSqlite3 = (db: Database.Database) => ({
  exec(s: string, params: unknown[] = []): Effect.Effect<void, UnknownException, never> {
    return Effect.try(() => {
      if (params.length === 0) {
        db.exec(s)
      } else {
        db.prepare(s).run(...params)
      }
    })
  },

  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Effect.Effect<T[], UnknownException, never> {
    return Effect.try(() => {
      const stmt = db.prepare(sql)

      if (stmt.reader) {
        return stmt.all(...params) as T[]
      }
      stmt.run(...params)
      return []
    })
  },

  queryStream<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Stream.Stream<T, UnknownException, never> {
    return Stream.fromIterableEffect(
      Effect.try<T[]>(() => {
        const stmt = db.prepare(sql)

        if (stmt.reader) {
          return stmt.all(...params) as T[]
        }
        stmt.run(...params)
        return []
      })
    )
  }
})

export const toPostgresParams = (sql: string): string => {
  let index = 0
  return sql.replace(/\?/g, () => `$${++index}`)
}
