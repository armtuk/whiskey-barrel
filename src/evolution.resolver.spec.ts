import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Effect } from "effect"
import { resolveEvolutionFiles } from "./evolution.resolver.js"

let tmpDir: string

beforeEach(() => {
  tmpDir = join(tmpdir(), `ev-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tmpDir, { recursive: true })
})

afterEach(() => {
  // cleanup handled by OS tmpdir GC; no explicit removal needed for test isolation
})

const makeEvolutionDir = (base: string, name: string, files: string[]): string => {
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  for (const f of files) writeFileSync(join(dir, f), "")
  return dir
}

describe("resolveEvolutionFiles", () => {
  it("returns an empty array when directory does not exist", () => {
    const refs = Effect.runSync(resolveEvolutionFiles(tmpDir, "nonexistent"))
    expect(refs).toEqual([])
  })

  it("returns files sorted numerically, not lexicographically", () => {
    makeEvolutionDir(tmpDir, "mydb", ["1.sql", "10.sql", "2.sql", "9.sql"])
    const refs = Effect.runSync(resolveEvolutionFiles(tmpDir, "mydb"))
    expect(refs.map(r => r.id)).toEqual([1, 2, 9, 10])
  })

  it("returns correct file paths", () => {
    makeEvolutionDir(tmpDir, "mydb", ["1.sql", "2.sql"])
    const refs = Effect.runSync(resolveEvolutionFiles(tmpDir, "mydb"))
    expect(refs[0].filePath).toContain("1.sql")
    expect(refs[1].filePath).toContain("2.sql")
  })

  it("handles zero-padded filenames (01.sql, 001.sql) — parsed as integers", () => {
    makeEvolutionDir(tmpDir, "mydb", ["001.sql", "010.sql", "002.sql"])
    const refs = Effect.runSync(resolveEvolutionFiles(tmpDir, "mydb"))
    expect(refs.map(r => r.id)).toEqual([1, 2, 10])
  })

  it("ignores non-numeric sql files", () => {
    makeEvolutionDir(tmpDir, "mydb", ["1.sql", "schema.sql", "readme.sql"])
    const refs = Effect.runSync(resolveEvolutionFiles(tmpDir, "mydb"))
    expect(refs.map(r => r.id)).toEqual([1])
  })

  it("uses type-specific directory when dbType matches", () => {
    makeEvolutionDir(tmpDir, "mydb.sqlite", ["1.sql"])
    makeEvolutionDir(tmpDir, "mydb", ["1.sql", "2.sql"])
    const refs = Effect.runSync(resolveEvolutionFiles(tmpDir, "mydb", "sqlite"))
    expect(refs).toHaveLength(1)
  })

  it("falls back to generic directory when type-specific does not exist", () => {
    makeEvolutionDir(tmpDir, "mydb", ["1.sql", "2.sql"])
    const refs = Effect.runSync(resolveEvolutionFiles(tmpDir, "mydb", "postgresql"))
    expect(refs).toHaveLength(2)
  })
})
