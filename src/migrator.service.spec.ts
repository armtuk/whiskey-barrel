import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect, Layer, Stream } from "effect"
import { MigratorService, MigratorServiceLive } from "./migrator.service.js"
import { SqlRunner } from "./util/sql-runner.js"
import { fromBetterSqlite3 } from "./util/sql-runner.js"
import { EvolutionRepositoryLive } from "./evolution.repository.js"
import { EvolutionFileServiceLive, FileLineReader } from "./evolution-file.service.ts"
import { EvolutionFileParserLive } from "./evolution.parser.js"
import type { MigratorOptions } from "./types.js"

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SQL_1 = "-- #### !Ups\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n-- #### !Downs\nDROP TABLE users;"
const SQL_2 = "-- #### !Ups\nCREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);\n-- #### !Downs\nDROP TABLE posts;"
const SQL_3 = "-- #### !Ups\nCREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT);\n-- #### !Downs\nDROP TABLE tags;"
const SQL_2_CHANGED = "-- #### !Ups\nCREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT);\n-- #### !Downs\nDROP TABLE posts;"

// ── Test Helpers ──────────────────────────────────────────────────────────────

interface TestEnv {
  db: Database.Database
  evolutionsRoot: string
  writeFile: (name: string, content: string) => void
  run: <A, E>(effect: Effect.Effect<A, E, MigratorService>) => Promise<A>
}

const createTestEnv = (): TestEnv => {
  const evolutionsRoot = join(tmpdir(), `ev-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const dbDir = join(evolutionsRoot, "testdb")
  mkdirSync(dbDir, { recursive: true })

  const db = new Database(":memory:")

  const options: MigratorOptions = {
    dbName: "testdb",
    dbType: "sqlite",
    evolutionsRoot,
    tableName: "db_evolutions"
  }

  const SqlRunnerLive = Layer.succeed(SqlRunner, fromBetterSqlite3(db))

  const FileLineReaderLive = Layer.succeed(FileLineReader, {
    lineStreamFromFile: (path: string) =>
      Effect.sync(() =>
        Stream.fromIterable(readFileSync(path, "utf-8").split("\n"))
      ),
    linesFromFile: (path: string) =>
      Effect.sync(() => readFileSync(path, "utf-8").split("\n"))
  })

  const RepoLive = EvolutionRepositoryLive(options.tableName).pipe(
    Layer.provide(SqlRunnerLive)
  )

  const FileServiceLive = EvolutionFileServiceLive(options).pipe(
    Layer.provide(EvolutionFileParserLive()),
    Layer.provide(FileLineReaderLive)
  )

  const DepsLive = Layer.mergeAll(SqlRunnerLive, RepoLive, FileServiceLive)

  const ServiceLive = MigratorServiceLive(options).pipe(
    Layer.provide(DepsLive)
  )

  const run = <A, E>(effect: Effect.Effect<A, E, MigratorService>): Promise<A> =>
    Effect.runPromise(Effect.provide(effect, ServiceLive))

  const writeFile = (name: string, content: string) => {
    writeFileSync(join(dbDir, name), content)
  }

  return { db, evolutionsRoot, writeFile, run }
}

const countRows = (db: Database.Database, table: string): number =>
  (db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number }).n

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("MigratorService.apply()", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
  })
  afterEach(() => {
    env.db.close()
  })

  it("happy path: applies migrations, all rows in db_evolutions with state=applied", async () => {
    env.writeFile("1.sql", SQL_1)
    env.writeFile("2.sql", SQL_2)
    env.writeFile("3.sql", SQL_3)

    const result = await env.run(
      Effect.flatMap(MigratorService, svc => svc.apply())
    )

    expect(result._tag).toBe("ApplySuccessResult")
    expect(countRows(env.db, "db_evolutions")).toBe(3)
    const states = env.db.prepare("SELECT state FROM db_evolutions").all() as { state: string }[]
    expect(states.every(s => s.state === "applied")).toBe(true)
  })

  it("no-op when nothing has changed", async () => {
    env.writeFile("1.sql", SQL_1)

    await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))
    const result = await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))

    expect(result._tag).toBe("ApplySuccessResult")
  })

  it("new files beyond existing records are applied without rollback", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))

    env.writeFile("2.sql", SQL_2)
    const result = await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))

    expect(result._tag).toBe("ApplySuccessResult")
    expect(countRows(env.db, "db_evolutions")).toBe(2)
  })

  it("returns failure when stuck evolution is detected", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))

    env.db.prepare("UPDATE db_evolutions SET state = 'applying_up' WHERE id = 1").run()

    const result = await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))

    expect(result._tag).toBe("ApplyFailureResult")
  })

  it("custom tableName creates table with that name", async () => {
    const customRoot = join(tmpdir(), `ev-custom-${Date.now()}`)
    const customDbDir = join(customRoot, "testdb")
    mkdirSync(customDbDir, { recursive: true })
    writeFileSync(join(customDbDir, "1.sql"), SQL_1)

    const customDb = new Database(":memory:")
    const customOptions: MigratorOptions = {
      dbName: "testdb",
      dbType: "sqlite",
      evolutionsRoot: customRoot,
      tableName: "my_migrations"
    }

    const SqlRunnerLayer = Layer.succeed(SqlRunner, fromBetterSqlite3(customDb))
    const FileLineReaderLayer = Layer.succeed(FileLineReader, {
      lineStreamFromFile: (path: string) =>
        Effect.sync(() =>
          Stream.fromIterable(readFileSync(path, "utf-8").split("\n"))
        ),
      linesFromFile: (path: string) =>
        Effect.sync(() => readFileSync(path, "utf-8").split("\n"))
    })
    const RepoLayer = EvolutionRepositoryLive("my_migrations").pipe(Layer.provide(SqlRunnerLayer))
    const FileServiceLayer = EvolutionFileServiceLive(customOptions).pipe(
      Layer.provide(EvolutionFileParserLive()),
      Layer.provide(FileLineReaderLayer)
    )
    const DepsLayer = Layer.mergeAll(SqlRunnerLayer, RepoLayer, FileServiceLayer)
    const ServiceLayer = MigratorServiceLive(customOptions).pipe(
      Layer.provide(DepsLayer)
    )

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(MigratorService, svc => svc.apply()),
        ServiceLayer
      )
    )

    expect(result._tag).toBe("ApplySuccessResult")
    expect(countRows(customDb, "my_migrations")).toBe(1)
    customDb.close()
  })
})

describe("MigratorService.resolve()", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
  })
  afterEach(() => {
    env.db.close()
  })

  it("resolves a stuck applying_up evolution to applied", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))
    env.db.prepare("UPDATE db_evolutions SET state = 'applying_up' WHERE id = 1").run()

    const result = await env.run(Effect.flatMap(MigratorService, svc => svc.resolve(1)))

    expect(result.status).toBe("success")
    const row = env.db.prepare("SELECT state FROM db_evolutions WHERE id = 1").get() as { state: string }
    expect(row.state).toBe("applied")
  })

  it("resolves a stuck applying_down evolution by deleting the row", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))
    env.db.prepare("UPDATE db_evolutions SET state = 'applying_down' WHERE id = 1").run()

    const result = await env.run(Effect.flatMap(MigratorService, svc => svc.resolve(1)))

    expect(result.status).toBe("success")
    expect(countRows(env.db, "db_evolutions")).toBe(0)
  })

  it("returns failure for non-existent id", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))

    const result = await env.run(Effect.flatMap(MigratorService, svc => svc.resolve(99)))
    expect(result.status).toBe("failure")
  })

  it("returns failure for evolution that is not stuck", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.run(Effect.flatMap(MigratorService, svc => svc.apply()))

    const result = await env.run(Effect.flatMap(MigratorService, svc => svc.resolve(1)))

    expect(result.status).toBe("failure")
  })
})
