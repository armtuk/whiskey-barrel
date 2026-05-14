import type { ConnectionConfig } from "../types.js"
import type { MigrationDriver } from "./driver.types.js"

export const createDriverFromConfig = async (config: ConnectionConfig): Promise<MigrationDriver> => {
  switch (config.type) {
    case "sqlite":
      return createSqliteDriver(config.path)
    case "postgresql":
      return createPostgresqlDriver(config)
  }
}

const createSqliteDriver = async (path: string): Promise<MigrationDriver> => {
  try {
    const { default: Database } = await import("better-sqlite3")
    const { fromBetterSqlite3 } = await import("./better-sqlite3.driver.js")
    return fromBetterSqlite3(new Database(path))
  } catch {
    throw new Error('SQLite driver requires "better-sqlite3" as a dependency. Install it with: pnpm add better-sqlite3')
  }
}

const createPostgresqlDriver = async (config: Extract<ConnectionConfig, { type: "postgresql" }>): Promise<MigrationDriver> => {
  try {
    const { Pool } = await import("pg")
    const { fromPgPool } = await import("./pg.driver.js")

    const pool = config.connectionString
      ? new Pool({ connectionString: config.connectionString, ssl: config.ssl ? { rejectUnauthorized: false } : undefined })
      : new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined
      })

    return fromPgPool(pool)
  } catch {
    throw new Error('PostgreSQL driver requires "pg" as a dependency. Install it with: pnpm add pg')
  }
}
