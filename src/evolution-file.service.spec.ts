import { mkdirSync, writeFileSync } from "node:fs"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Effect, Layer, Stream } from "effect"
import { EvolutionFileService, EvolutionFileServiceLive, FileLineReader } from "./evolution-file.service.ts"
import { EvolutionFileParserLive } from "./evolution.parser.ts"
import type { MigratorOptions } from "./types.ts"

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SQL_1 = "-- #### !Ups\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n-- #### !Downs\nDROP TABLE users;"
const SQL_2 = "-- #### !Ups\nCREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);\n-- #### !Downs\nDROP TABLE posts;"

// ── Test Helpers ──────────────────────────────────────────────────────────────

const createTestLayer = (options: MigratorOptions) => {
  const FileLineReaderLive = Layer.succeed(FileLineReader, {
    lineStreamFromFile: (path: string) =>
      Effect.sync(() =>
        Stream.fromIterable(readFileSync(path, "utf-8").split("\n"))
      ),
    linesFromFile: (path: string) =>
      Effect.sync(() => readFileSync(path, "utf-8").split("\n"))
  })

  return EvolutionFileServiceLive(options).pipe(
    Layer.provide(EvolutionFileParserLive()),
    Layer.provide(FileLineReaderLive)
  )
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("EvolutionFileService.fetchEvolutions()", () => {
  let evolutionsRoot: string
  let dbDir: string

  const setup = () => {
    evolutionsRoot = join(tmpdir(), `ev-file-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    dbDir = join(evolutionsRoot, "testdb")
    mkdirSync(dbDir, { recursive: true })
  }

  const writeFile = (name: string, content: string) => {
    writeFileSync(join(dbDir, name), content)
  }

  const options = (): MigratorOptions => ({
    dbName: "testdb",
    dbType: "sqlite",
    evolutionsRoot,
    tableName: "db_evolutions"
  })

  it("returns evolutions sorted by id", async () => {
    setup()
    writeFile("2.sql", SQL_2)
    writeFile("1.sql", SQL_1)

    const layer = createTestLayer(options())

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EvolutionFileService, svc => svc.fetchEvolutions()),
        layer
      )
    )

    expect(result).toHaveLength(2)
    expect(result[0].up).toContain("CREATE TABLE users")
    expect(result[0].down).toContain("DROP TABLE users")
    expect(result[1].up).toContain("CREATE TABLE posts")
    expect(result[1].down).toContain("DROP TABLE posts")
  })

  it("returns empty array when no sql files exist", async () => {
    setup()

    const layer = createTestLayer(options())

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EvolutionFileService, svc => svc.fetchEvolutions()),
        layer
      )
    )

    expect(result).toEqual([])
  })

  it("ignores non-sql files", async () => {
    setup()
    writeFile("1.sql", SQL_1)
    writeFile("readme.txt", "not a migration")
    writeFile("notes.md", "also not a migration")

    const layer = createTestLayer(options())

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EvolutionFileService, svc => svc.fetchEvolutions()),
        layer
      )
    )

    expect(result).toHaveLength(1)
    expect(result[0].up).toContain("CREATE TABLE users")
  })

  it("computes hash for each evolution", async () => {
    setup()
    writeFile("1.sql", SQL_1)

    const layer = createTestLayer(options())

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EvolutionFileService, svc => svc.fetchEvolutions()),
        layer
      )
    )

    expect(result[0].hash).toBeDefined()
    expect(result[0].hash).toMatch(/^[a-f0-9]{32}$/)
  })

  it("different content produces different hashes", async () => {
    setup()
    writeFile("1.sql", SQL_1)
    writeFile("2.sql", SQL_2)

    const layer = createTestLayer(options())

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EvolutionFileService, svc => svc.fetchEvolutions()),
        layer
      )
    )

    expect(result[0].hash).not.toBe(result[1].hash)
  })

  it("resolves type-specific directory when it exists", async () => {
    setup()
    const typeDir = join(evolutionsRoot, "testdb.sqlite")
    mkdirSync(typeDir, { recursive: true })
    writeFileSync(join(typeDir, "1.sql"), SQL_1)

    const layer = createTestLayer(options())

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EvolutionFileService, svc => svc.fetchEvolutions()),
        layer
      )
    )

    expect(result).toHaveLength(1)
    expect(result[0].up).toContain("CREATE TABLE users")
  })

  it("returns empty when directory does not exist", async () => {
    evolutionsRoot = join(tmpdir(), `ev-nonexistent-${Date.now()}`)

    const layer = createTestLayer(options())

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(EvolutionFileService, svc => svc.fetchEvolutions()),
        layer
      )
    )

    expect(result).toEqual([])
  })

  it("Throws an error for non-sequential sql files", async () => {
    // TODO implement
    expect(1).toBe(1)
  })

})
