import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { Effect, Layer } from "effect"
import { describe, expect, it } from "vitest"
import { fromBetterSqlite3 } from "./drivers/better-sqlite3.driver.ts"
import { EvolutionFileParserLive } from "./evolution.parser.ts"
import { EvolutionRepositoryLive } from "./evolution.repository.ts"
import { EvolutionFileServiceLive, FileLineReader } from "./evolution-file.service.ts"
import { MigratorService, MigratorServiceLive } from "./migrator.service.ts"
import type { MigratorOptions } from "./types.ts"
import { fromMigrationDriver, SqlRunner } from "./util/sql-runner.ts"

const SQL_1 = "-- #### !Ups\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n-- #### !Downs\nDROP TABLE users;"

describe("driver lifecycle (close releases connection)", () => {
  it("better-sqlite3: close() releases the database handle after apply", async () => {
    const evolutionsRoot = join(tmpdir(), `ev-lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(evolutionsRoot, "testdb"), { recursive: true })
    writeFileSync(join(evolutionsRoot, "testdb", "1.sql"), SQL_1)

    const db = new Database(":memory:")
    const driver = fromBetterSqlite3(db)
    const sqlRunner = fromMigrationDriver(driver)

    const options: MigratorOptions = {
      dbName: "testdb",
      dbType: "sqlite",
      evolutionsRoot,
      tableName: "db_evolutions",
      quiet: true
    }

    const SqlRunnerLive = Layer.succeed(SqlRunner, sqlRunner)
    const FileLineReaderLive = Layer.succeed(FileLineReader, {
      linesFromFile: (path: string) => Effect.sync(() => readFileSync(path, "utf-8").split("\n"))
    })
    const RepoLive = EvolutionRepositoryLive(options.tableName).pipe(Layer.provide(SqlRunnerLive))
    const FileServiceLive = EvolutionFileServiceLive(options).pipe(
      Layer.provide(EvolutionFileParserLive()),
      Layer.provide(FileLineReaderLive)
    )
    const DepsLive = Layer.mergeAll(SqlRunnerLive, RepoLive, FileServiceLive)
    const ServiceLive = MigratorServiceLive(options).pipe(Layer.provide(DepsLive))

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(MigratorService, svc => svc.apply()),
        ServiceLive
      )
    )

    expect(result._tag).toBe("ApplySuccessResult")
    expect(db.open).toBe(true)

    await driver.close()

    expect(db.open).toBe(false)
  })

  it("better-sqlite3: close() is safe to call even if no migrations were run", async () => {
    const db = new Database(":memory:")
    const driver = fromBetterSqlite3(db)

    expect(db.open).toBe(true)
    await driver.close()
    expect(db.open).toBe(false)
  })

  it("close() is accessible through the SqlRunner Effect bridge", async () => {
    const db = new Database(":memory:")
    const driver = fromBetterSqlite3(db)
    const sqlRunner = fromMigrationDriver(driver)

    expect(db.open).toBe(true)

    await Effect.runPromise(sqlRunner.close())

    expect(db.open).toBe(false)
  })
})
