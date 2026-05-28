import { parseConnectionUrl } from "../types.ts"
import type { MigrationDriver } from "./driver.types.ts"
import { fromMigrationDriver } from "../util/sql-runner.ts"

export const createDriverFromConfig = async (connectionUrl: string): Promise<MigrationDriver> => {
  const { scheme, url } = parseConnectionUrl(connectionUrl)
  switch (scheme) {
    case "sqlite":
      return createSqliteDriver(url.pathname)
    case "postgresql":
      return createPostgresqlDriver(connectionUrl)
  }
}

export const createSqlRunnerFromConfig = async (connectionUrl: string) => {
  const driver = await createDriverFromConfig(connectionUrl)
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

const createPostgresqlDriver = async (connectionUrl: string): Promise<MigrationDriver> => {
  try {
    const { default: postgres } = await import("postgres")
    const { fromPostgresJs } = await import("./postgres-js.driver.js")
    return fromPostgresJs(postgres(connectionUrl))
  } catch (err) {
    if (err instanceof Error && err.message.includes("Cannot find")) {
      throw new Error('PostgreSQL driver requires "postgres" as a dependency. Install it with: pnpm add postgres')
    }
    throw err
  }
}
