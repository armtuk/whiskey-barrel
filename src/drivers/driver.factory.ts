import type { ConnectionConfig } from "../types.ts"
import type { MigrationDriver } from "./driver.types.ts"
import { fromMigrationDriver } from "../util/sql-runner.ts"

export const createDriverFromConfig = async (config: ConnectionConfig): Promise<MigrationDriver> => {
  switch (config.type) {
    case "sqlite":
      return createSqliteDriver(config.path)
    case "postgresql":
      return createPostgresqlDriver(config)
  }
}

export const createSqlRunnerFromConfig = async (config: ConnectionConfig) => {
  const driver = await createDriverFromConfig(config)
  return fromMigrationDriver(driver)
}

const createSqliteDriver = async (path: string): Promise<MigrationDriver> => {
  try {
    const { default: Database } = await import("better-sqlite3")
    const { fromBetterSqlite3 } = await import("./better-sqlite3.driver.js")
    return fromBetterSqlite3(new Database(path))
  } catch (err) {
    if (err instanceof Error && err.message.includes("Cannot find")) {
      throw new Error('SQLite driver requires "better-sqlite3" as a dependency. Install it with: pnpm add better-sqlite3')
    }
    throw err
  }
}

const createPostgresqlDriver = async (config: Extract<ConnectionConfig, { type: "postgresql" }>): Promise<MigrationDriver> => {
  try {
    const { default: postgres } = await import("postgres")
    const { fromPostgresJs } = await import("./postgres-js.driver.js")
    const sql = config.connectionString
      ? postgres(config.connectionString)
      : postgres({
          host: config.host,
          port: config.port,
          database: config.database,
          username: config.user,
          password: config.password,
          ssl: config.ssl ?? false
        })
    return fromPostgresJs(sql)
  } catch (err) {
    if (err instanceof Error && err.message.includes("Cannot find")) {
      throw new Error('PostgreSQL driver requires "postgres" as a dependency. Install it with: pnpm add postgres')
    }
    throw err
  }
}
