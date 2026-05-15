import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { EvolutionFileParser, EvolutionFileParserLive } from "./evolution.parser.js"

const parserLayer = EvolutionFileParserLive()

const run = <A, E>(effect: Effect.Effect<A, E, EvolutionFileParser>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, parserLayer))

// ── Fixtures ───────────────────────────────────────────────────────────────────

const STANDARD_LINES = [
  "-- #### !Ups",
  "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
  "",
  "-- #### !Downs",
  "DROP TABLE users;"
]

const MULTI_STATEMENT_LINES = [
  "-- #### !Ups",
  "CREATE TABLE users (id INTEGER PRIMARY KEY);",
  "CREATE TABLE posts (id INTEGER PRIMARY KEY);",
  "-- #### !Downs",
  "DROP TABLE posts;",
  "DROP TABLE users;"
]

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("parseEvolutionFile", () => {
  it("parses standard -- #### !Ups / -- #### !Downs markers", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc => svc.parseEvolutionFile(STANDARD_LINES))
    )
    expect(result.up).toContain("CREATE TABLE users")
    expect(result.down).toContain("DROP TABLE users")
  })

  it("produces a valid MD5 hash", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc => svc.parseEvolutionFile(STANDARD_LINES))
    )
    expect(result.hash).toMatch(/^[a-f0-9]{32}$/)
  })

  it("changing the down section changes the hash", async () => {
    const linesA = [
      "-- #### !Ups",
      "CREATE TABLE x (id INT);",
      "-- #### !Downs",
      "DROP TABLE x;"
    ]
    const linesB = [
      "-- #### !Ups",
      "CREATE TABLE x (id INT);",
      "-- #### !Downs",
      "DROP TABLE x CASCADE;"
    ]

    const [a, b] = await Promise.all([
      run(Effect.flatMap(EvolutionFileParser, svc => svc.parseEvolutionFile(linesA))),
      run(Effect.flatMap(EvolutionFileParser, svc => svc.parseEvolutionFile(linesB)))
    ])

    expect(a.hash).not.toBe(b.hash)
  })

  it("handles multiple statements in each section", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc => svc.parseEvolutionFile(MULTI_STATEMENT_LINES))
    )
    expect(result.up).toContain("CREATE TABLE users")
    expect(result.up).toContain("CREATE TABLE posts")
    expect(result.down).toContain("DROP TABLE posts")
    expect(result.down).toContain("DROP TABLE users")
  })
})

describe("extractSections", () => {
  it("extracts up and down sections", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc => svc.extractSections(STANDARD_LINES))
    )
    expect(result.up).toContain("CREATE TABLE users")
    expect(result.down).toContain("DROP TABLE users")
  })

  it("fails when no Ups marker is present", async () => {
    const lines = ["CREATE TABLE users (id INT);", "-- #### !Downs", "DROP TABLE users;"]

    await expect(
      run(Effect.flatMap(EvolutionFileParser, svc => svc.extractSections(lines)))
    ).rejects.toThrow()
  })

  it("fails when no Downs marker is present", async () => {
    const lines = ["-- #### !Ups", "CREATE TABLE users (id INT);"]

    await expect(
      run(Effect.flatMap(EvolutionFileParser, svc => svc.extractSections(lines)))
    ).rejects.toThrow()
  })

  it("up section does not include the marker lines", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc => svc.extractSections(STANDARD_LINES))
    )
    expect(result.up).not.toContain("#### !Ups")
    expect(result.up).not.toContain("#### !Downs")
  })

  it("down section does not include the marker line", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc => svc.extractSections(STANDARD_LINES))
    )
    expect(result.down).not.toContain("#### !Downs")
  })
})

describe("computeHash", () => {
  it("produces consistent MD5 hash", async () => {
    const { createHash } = await import("node:crypto")
    const lines = ["line1", "line2", "line3"]

    const result = await run(
      Effect.map(EvolutionFileParser, svc => svc.computeHash(lines))
    )

    const expected = createHash("md5")
    lines.forEach(l => expected.update(l.trim()))
    expect(result).toBe(expected.digest("hex"))
  })

  it("same content produces same hash", async () => {
    const lines = ["-- #### !Ups", "CREATE TABLE x (id INT);", "-- #### !Downs", "DROP TABLE x;"]

    const [a, b] = await Promise.all([
      run(Effect.map(EvolutionFileParser, svc => svc.computeHash(lines))),
      run(Effect.map(EvolutionFileParser, svc => svc.computeHash(lines)))
    ])

    expect(a).toBe(b)
  })
})

describe("splitStatements", () => {
  it("splits on single semicolons", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc =>
        Effect.succeed(svc.splitStatements("CREATE TABLE a (id INT); CREATE TABLE b (id INT);"))
      )
    )
    expect(result).toEqual(["CREATE TABLE a (id INT)", "CREATE TABLE b (id INT)"])
  })

  it("does not split on ;; escaped semicolons", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc =>
        Effect.succeed(svc.splitStatements("INSERT INTO t VALUES ('a;;b'); SELECT 1;"))
      )
    )
    expect(result).toHaveLength(2)
    expect(result[0]).toContain("a;;b")
  })

  it("trims and filters empty segments", async () => {
    const result = await run(
      Effect.flatMap(EvolutionFileParser, svc =>
        Effect.succeed(svc.splitStatements("  SELECT 1 ;  ; SELECT 2;  "))
      )
    )
    expect(result).toEqual(["SELECT 1", "SELECT 2"])
  })

  it("returns empty array for blank input", async () => {
    const [a, b] = await Promise.all([
      run(Effect.flatMap(EvolutionFileParser, svc => Effect.succeed(svc.splitStatements("")))),
      run(Effect.flatMap(EvolutionFileParser, svc => Effect.succeed(svc.splitStatements("   "))))
    ])
    expect(a).toEqual([])
    expect(b).toEqual([])
  })
})
