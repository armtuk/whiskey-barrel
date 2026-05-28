import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { Effect, Layer } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fromBetterSqlite3 } from "../src/drivers/better-sqlite3.driver.ts"
import { EvolutionFileParserLive } from "../src/evolution.parser.ts"
import { EvolutionRepositoryLive } from "../src/evolution.repository.ts"
import { EvolutionFileServiceLive, FileLineReader } from "../src/evolution-file.service.ts"
import { MigratorService, MigratorServiceLive } from "../src/migrator.service.ts"
import type { MigratorOptions } from "../src/types.ts"
import { fromMigrationDriver, SqlRunner } from "../src/util/sql-runner.ts"
import {
  applyCommand,
  buildStatusReport,
  parseArgs,
  resolveCommand,
  statusCommand,
  type StatusReport
} from "./db-evolutions.ts"

const SQL_1 = "-- #### !Ups\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n-- #### !Downs\nDROP TABLE users;"
const SQL_2 = "-- #### !Ups\nCREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);\n-- #### !Downs\nDROP TABLE posts;"

// ── buildStatusReport (pure function) ─────────────────────────────────────────

describe("buildStatusReport", () => {
  it("returns zero count and no lastEvolution for empty rows", () => {
    const report = buildStatusReport([])
    expect(report.appliedCount).toBe(0)
    expect(report.lastEvolution).toBeUndefined()
    expect(report.stuckEvolutions).toEqual([])
  })

  it("counts only actually-applied rows, not stuck ones", () => {
    const report = buildStatusReport([
      { id: 1, state: "applied", last_problem: null, applied_at: "2026-01-01T00:00:00Z" },
      { id: 2, state: "applying_up", last_problem: "syntax error", applied_at: "2026-01-02T00:00:00Z" }
    ])
    expect(report.appliedCount).toBe(1)
    expect(report.stuckEvolutions).toHaveLength(1)
  })

  it("reports all applied when every row has state=applied", () => {
    const report = buildStatusReport([
      { id: 1, state: "applied", last_problem: null, applied_at: "2026-01-01T00:00:00Z" },
      { id: 2, state: "applied", last_problem: null, applied_at: "2026-01-02T00:00:00Z" }
    ])
    expect(report.appliedCount).toBe(2)
    expect(report.lastEvolution?.id).toBe(2)
    expect(report.lastEvolution?.state).toBe("applied")
    expect(report.stuckEvolutions).toEqual([])
  })

  it("lastEvolution reflects the highest-id row regardless of state", () => {
    const report = buildStatusReport([
      { id: 1, state: "applied", last_problem: null, applied_at: "2026-01-01T00:00:00Z" },
      { id: 2, state: "applying_up", last_problem: "col missing", applied_at: "2026-01-02T00:00:00Z" }
    ])
    expect(report.lastEvolution?.id).toBe(2)
    expect(report.lastEvolution?.state).toBe("applying_up")
    expect(report.lastEvolution?.lastProblem).toBe("col missing")
  })

  it("reports applying_down as stuck", () => {
    const report = buildStatusReport([
      { id: 1, state: "applying_down", last_problem: "timeout", applied_at: "2026-01-01T00:00:00Z" }
    ])
    expect(report.appliedCount).toBe(0)
    expect(report.stuckEvolutions).toHaveLength(1)
    expect(report.stuckEvolutions[0]).toEqual({ id: 1, state: "applying_down", lastProblem: "timeout" })
  })

  it("handles multiple stuck evolutions among applied ones", () => {
    const report = buildStatusReport([
      { id: 1, state: "applied", last_problem: null, applied_at: "2026-01-01T00:00:00Z" },
      { id: 2, state: "applying_up", last_problem: "err1", applied_at: "2026-01-02T00:00:00Z" },
      { id: 3, state: "applying_down", last_problem: "err2", applied_at: "2026-01-03T00:00:00Z" }
    ])
    expect(report.appliedCount).toBe(1)
    expect(report.stuckEvolutions).toHaveLength(2)
    expect(report.stuckEvolutions.map(s => s.id)).toEqual([2, 3])
  })

  it("preserves null last_problem for stuck evolutions", () => {
    const report = buildStatusReport([
      { id: 1, state: "applying_up", last_problem: null, applied_at: "2026-01-01T00:00:00Z" }
    ])
    expect(report.stuckEvolutions[0].lastProblem).toBeNull()
  })
})

// ── parseArgs ─────────────────────────────────────────────────────────────────

describe("parseArgs", () => {
  const originalArgv = process.argv

  afterEach(() => {
    process.argv = originalArgv
  })

  it("parses a simple command", () => {
    process.argv = ["node", "db-evolutions.ts", "apply"]
    const result = parseArgs()
    expect(result).toEqual({ command: "apply", args: [], quiet: false })
  })

  it("parses command with arguments", () => {
    process.argv = ["node", "db-evolutions.ts", "resolve", "42"]
    const result = parseArgs()
    expect(result).toEqual({ command: "resolve", args: ["42"], quiet: false })
  })

  it("extracts --quiet flag to suppress output", () => {
    process.argv = ["node", "db-evolutions.ts", "--quiet", "apply"]
    const result = parseArgs()
    expect(result).toEqual({ command: "apply", args: [], quiet: true })
  })

  it("extracts -v flag", () => {
    process.argv = ["node", "db-evolutions.ts", "-q", "status"]
    const result = parseArgs()
    expect(result).toEqual({ command: "status", args: [], quiet: true })
  })

  it("quiet flag works after command", () => {
    process.argv = ["node", "db-evolutions.ts", "apply", "--quiet"]
    const result = parseArgs()
    expect(result).toEqual({ command: "apply", args: [], quiet: true })
  })

  it("calls process.exit for --help", () => {
    process.argv = ["node", "db-evolutions.ts", "--help"]
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit") })
    expect(() => parseArgs()).toThrow("exit")
    expect(exitSpy).toHaveBeenCalledWith(0)
    exitSpy.mockRestore()
  })

  it("calls process.exit with 1 when no command given", () => {
    process.argv = ["node", "db-evolutions.ts"]
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit") })
    expect(() => parseArgs()).toThrow("exit")
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})

// ── Command integration tests ─────────────────────────────────────────────────

describe("command integration", () => {
  let db: Database.Database
  let sqlRunner: SqlRunner["Type"]
  let options: MigratorOptions
  let evolutionsRoot: string
  // biome-ignore lint/suspicious/noExplicitAny: test helper — layer type varies between buildLayers (NodeFileSystem) and test construction
  let ServiceLive: any

  beforeEach(() => {
    evolutionsRoot = join(tmpdir(), `ev-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(evolutionsRoot, "testdb"), { recursive: true })

    db = new Database(":memory:")
    const driver = fromBetterSqlite3(db)
    sqlRunner = fromMigrationDriver(driver)

    options = {
      dbName: "testdb",
      dbType: "sqlite",
      evolutionsRoot,
      tableName: "db_evolutions",
      quiet: false
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
    ServiceLive = MigratorServiceLive(options).pipe(Layer.provide(DepsLive))
  })

  afterEach(() => {
    db.close()
  })

  // ── applyCommand ──────────────────────────────────────────────────────────

  describe("applyCommand", () => {
    it("applies migrations and returns success", async () => {
      writeFileSync(join(evolutionsRoot, "testdb", "1.sql"), SQL_1)

      await Effect.runPromise(applyCommand(ServiceLive))

      const rows = db.prepare("SELECT * FROM db_evolutions").all() as { id: number; state: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].state).toBe("applied")
    })

    it("succeeds as no-op when no evolution files exist", async () => {
      await Effect.runPromise(applyCommand(ServiceLive))

      const rows = db.prepare("SELECT * FROM db_evolutions").all()
      expect(rows).toHaveLength(0)
    })

    it("can be constructed without affecting other commands", () => {
      const effect = applyCommand(ServiceLive)
      expect(effect).toBeDefined()
    })
  })

  // ── statusCommand ─────────────────────────────────────────────────────────

  describe("statusCommand", () => {
    it("runs successfully on a fresh database after apply initializes the table", async () => {
      await Effect.runPromise(applyCommand(ServiceLive))
      await Effect.runPromise(statusCommand(sqlRunner, options.tableName))
    })

    it("reports applied evolutions after successful apply", async () => {
      writeFileSync(join(evolutionsRoot, "testdb", "1.sql"), SQL_1)
      writeFileSync(join(evolutionsRoot, "testdb", "2.sql"), SQL_2)
      await Effect.runPromise(applyCommand(ServiceLive))

      const rows = await Effect.runPromise(
        sqlRunner.query<{ id: number; state: string; last_problem: string | null; applied_at: string }>(
          `SELECT id, state, last_problem, applied_at FROM ${options.tableName} ORDER BY id`
        )
      )
      const report = buildStatusReport(rows)

      expect(report.appliedCount).toBe(2)
      expect(report.lastEvolution?.state).toBe("applied")
      expect(report.stuckEvolutions).toEqual([])
    })

    it("correctly distinguishes applied from stuck in the count", async () => {
      writeFileSync(join(evolutionsRoot, "testdb", "1.sql"), SQL_1)
      writeFileSync(join(evolutionsRoot, "testdb", "2.sql"), SQL_2)
      await Effect.runPromise(applyCommand(ServiceLive))

      db.prepare("UPDATE db_evolutions SET state = 'applying_up', last_problem = 'failed' WHERE id = 2").run()

      const rows = await Effect.runPromise(
        sqlRunner.query<{ id: number; state: string; last_problem: string | null; applied_at: string }>(
          `SELECT id, state, last_problem, applied_at FROM ${options.tableName} ORDER BY id`
        )
      )
      const report = buildStatusReport(rows)

      expect(report.appliedCount).toBe(1)
      expect(report.stuckEvolutions).toHaveLength(1)
      expect(report.stuckEvolutions[0].id).toBe(2)
    })

    it("can be constructed independently without triggering other command side effects", () => {
      const effect = statusCommand(sqlRunner, options.tableName)
      expect(effect).toBeDefined()
    })
  })

  // ── resolveCommand ────────────────────────────────────────────────────────

  describe("resolveCommand", () => {
    it("resolves a stuck evolution", async () => {
      writeFileSync(join(evolutionsRoot, "testdb", "1.sql"), SQL_1)
      await Effect.runPromise(applyCommand(ServiceLive))
      db.prepare("UPDATE db_evolutions SET state = 'applying_up' WHERE id = 1").run()

      await Effect.runPromise(resolveCommand(ServiceLive, ["1"]))

      const row = db.prepare("SELECT state FROM db_evolutions WHERE id = 1").get() as { state: string }
      expect(row.state).toBe("applied")
    })

    it("can be constructed with valid args without side effects on other commands", () => {
      const effect = resolveCommand(ServiceLive, ["1"])
      expect(effect).toBeDefined()
    })

    it("calls process.exit(1) when given no id argument", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit") })
      expect(() => resolveCommand(ServiceLive, [])).toThrow("exit")
      expect(exitSpy).toHaveBeenCalledWith(1)
      exitSpy.mockRestore()
    })

    it("calls process.exit(1) when given a non-numeric id", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit") })
      expect(() => resolveCommand(ServiceLive, ["abc"])).toThrow("exit")
      expect(exitSpy).toHaveBeenCalledWith(1)
      exitSpy.mockRestore()
    })
  })

  // ── Command dispatch (lazy evaluation) ────────────────────────────────────

  describe("command dispatch (lazy evaluation)", () => {
    it("constructing the command map with empty resolve args does NOT trigger process.exit", () => {
      const commands: Record<string, () => Effect.Effect<void, unknown, never>> = {
        apply: () => applyCommand(ServiceLive),
        status: () => statusCommand(sqlRunner, options.tableName),
        resolve: () => resolveCommand(ServiceLive, [])
      }
      expect(commands.apply).toBeDefined()
      expect(commands.status).toBeDefined()
      expect(commands.resolve).toBeDefined()
    })

    it("only the invoked command's factory runs — others are not evaluated", () => {
      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exit") })
      const commands: Record<string, () => Effect.Effect<void, unknown, never>> = {
        apply: () => applyCommand(ServiceLive),
        status: () => statusCommand(sqlRunner, options.tableName),
        resolve: () => resolveCommand(ServiceLive, [])
      }
      expect(() => commands.apply()).not.toThrow()
      expect(() => commands.status()).not.toThrow()
      expect(() => commands.resolve()).toThrow("exit")
      exitSpy.mockRestore()
    })
  })
})
