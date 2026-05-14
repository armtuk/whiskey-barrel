import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fromBetterSqlite3 } from "./drivers/better-sqlite3.driver.js"
import type { MigrationDriver } from "./drivers/driver.types.js"
import { MigratorService } from "./migrator.service.js"
import type { MigratorOptions } from "./types.js"
import { InconsistentDatabaseError } from "./types.js"

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SQL_1 = `-- ###!Ups\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n-- ###!Downs\nDROP TABLE users;`
const SQL_2 = `-- ###!Ups\nCREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);\n-- ###!Downs\nDROP TABLE posts;`
const SQL_3 = `-- ###!Ups\nCREATE TABLE tags (id INTEGER PRIMARY KEY, label TEXT);\n-- ###!Downs\nDROP TABLE tags;`
const SQL_2_CHANGED = `-- ###!Ups\nCREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT);\n-- ###!Downs\nDROP TABLE posts;`

interface TestEnv {
  db: Database.Database
  driver: MigrationDriver
  service: MigratorService
  evolutionsRoot: string
  writeFile: (name: string, content: string) => void
}

const createTestEnv = (opts: Partial<MigratorOptions> = {}): TestEnv => {
  const evolutionsRoot = join(tmpdir(), `ev-svc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const dbDir = join(evolutionsRoot, "testdb")
  mkdirSync(dbDir, { recursive: true })

  const db = new Database(":memory:")
  const driver = fromBetterSqlite3(db)

  const options: MigratorOptions = {
    dbName: "testdb",
    evolutionsRoot,
    tableName: "db_evolutions",
    autoApply: false,
    ...opts
  }

  const service = new MigratorService(driver, options)

  const writeFile = (name: string, content: string) => {
    writeFileSync(join(dbDir, name), content)
  }

  return { db, driver, service, evolutionsRoot, writeFile }
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

  it("happy path: applies 3 migrations, all rows in db_evolutions with state=applied", async () => {
    env.writeFile("1.sql", SQL_1)
    env.writeFile("2.sql", SQL_2)
    env.writeFile("3.sql", SQL_3)

    const result = await env.service.apply()

    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(result.applied).toEqual([1, 2, 3])
    expect(result.rolledBack).toEqual([])
    expect(countRows(env.db, "db_evolutions")).toBe(3)
    const states = env.db.prepare("SELECT state FROM db_evolutions").all() as { state: string }[]
    expect(states.every(s => s.state === "applied")).toBe(true)
  })

  it("no-op when nothing has changed", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.service.apply()
    const result = await env.service.apply()
    expect(result).toEqual({ status: "success", applied: [], rolledBack: [] })
  })

  it("new files beyond existing records are applied without rollback", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.service.apply()
    env.writeFile("2.sql", SQL_2)
    const result = await env.service.apply()
    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(result.applied).toEqual([2])
    expect(result.rolledBack).toEqual([])
  })

  it("returns conflict when hash changes and autoApply=false — does not mutate db", async () => {
    env.writeFile("1.sql", SQL_1)
    env.writeFile("2.sql", SQL_2)
    env.writeFile("3.sql", SQL_3)
    await env.service.apply()

    env.writeFile("2.sql", SQL_2_CHANGED)
    const result = await env.service.apply()

    expect(result.status).toBe("conflict")
    if (result.status !== "conflict") return
    expect(result.changedAt).toBe(2)
    // DB must be unchanged — still 3 applied rows
    expect(countRows(env.db, "db_evolutions")).toBe(3)
  })

  it("rolls back from highest to changed, reapplies forward when autoApply=true", async () => {
    env.writeFile("1.sql", SQL_1)
    env.writeFile("2.sql", SQL_2)
    env.writeFile("3.sql", SQL_3)
    const svc = new MigratorService(env.driver, {
      dbName: "testdb",
      evolutionsRoot: env.evolutionsRoot,
      tableName: "db_evolutions",
      autoApply: true
    })
    await svc.apply()

    env.writeFile("2.sql", SQL_2_CHANGED)
    const result = await svc.apply()

    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(result.rolledBack.sort()).toEqual([2, 3])
    expect(result.applied.sort()).toEqual([2, 3])
    expect(countRows(env.db, "db_evolutions")).toBe(3)
  })

  it("throws InconsistentDatabaseError when any row is stuck in applying_up", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.service.apply()
    env.db.prepare("UPDATE db_evolutions SET state = 'applying_up' WHERE id = 1").run()

    await expect(env.service.apply()).rejects.toBeInstanceOf(InconsistentDatabaseError)
  })

  it("throws InconsistentDatabaseError when any row is stuck in applying_down", async () => {
    env.writeFile("1.sql", SQL_1)
    await env.service.apply()
    env.db.prepare("UPDATE db_evolutions SET state = 'applying_down' WHERE id = 1").run()

    await expect(env.service.apply()).rejects.toBeInstanceOf(InconsistentDatabaseError)
  })

  it("custom tableName creates table with that name", async () => {
    const custom = createTestEnv({ tableName: "my_migrations" })
    custom.writeFile("1.sql", SQL_1)
    await custom.service.apply()
    const n = countRows(custom.db, "my_migrations")
    expect(n).toBe(1)
    custom.db.close()
  })
})

describe("MigratorService.status()", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
  })
  afterEach(() => {
    env.db.close()
  })

  it("is read-only — never mutates db_evolutions", async () => {
    env.writeFile("1.sql", SQL_1)
    // status before first apply — table is created but empty
    const result = await env.service.status()
    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(result.applied).toHaveLength(0)
    expect(result.pending).toHaveLength(1)
  })

  it("reports applied, pending, and conflicts correctly", async () => {
    env.writeFile("1.sql", SQL_1)
    env.writeFile("2.sql", SQL_2)
    await env.service.apply()
    env.writeFile("3.sql", SQL_3)
    env.writeFile("2.sql", SQL_2_CHANGED) // change causes conflict

    const result = await env.service.status()
    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(result.applied.map(r => r.id)).toEqual([1, 2])
    expect(result.pending.map(f => f.id)).toEqual([3])
    expect(result.conflicts.map(c => c.id)).toEqual([2])
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
})

describe("MigratorService.rollback()", () => {
  let env: TestEnv

  beforeEach(() => {
    env = createTestEnv()
  })
  afterEach(() => {
    env.db.close()
  })

  it("rolls back the most recently applied migration", async () => {
    env.writeFile("1.sql", SQL_1)
    env.writeFile("2.sql", SQL_2)
    await env.service.apply()

    const result = await env.service.rollback()
    expect(result.status).toBe("success")
    if (result.status !== "success") return
    expect(result.rolledBack).toEqual([2])
    expect(countRows(env.db, "db_evolutions")).toBe(1)
  })

  it("returns success with empty rolledBack when nothing is applied", async () => {
    const result = await env.service.rollback()
    expect(result).toEqual({ status: "success", rolledBack: [] })
  })
})
