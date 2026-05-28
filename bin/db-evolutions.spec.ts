import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

const CLI_PATH = join(__dirname, "db-evolutions.ts")
const SQL_1 = "-- #### !Ups\nCREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\n-- #### !Downs\nDROP TABLE users;"
const SQL_2 = "-- #### !Ups\nCREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);\n-- #### !Downs\nDROP TABLE posts;"

// ── Test Harness ──────────────────────────────────────────────────────────────

interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
}

const runCli = (args: string[], cwd: string, env: Record<string, string> = {}): CliResult => {
  const stderrFile = join(tmpdir(), `wb-stderr-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
  const shellCmd = `npx tsx ${CLI_PATH} ${args.map(a => `'${a}'`).join(" ")} 2>${stderrFile}`
  try {
    const stdout = execFileSync("sh", ["-c", shellCmd], {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf-8",
      timeout: 15000
    })
    const stderr = readFileSync(stderrFile, "utf-8")
    rmSync(stderrFile, { force: true })
    return { stdout, stderr, exitCode: 0 }
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number }
    let stderr = ""
    try { stderr = readFileSync(stderrFile, "utf-8") } catch {}
    rmSync(stderrFile, { force: true })
    return {
      stdout: e.stdout ?? "",
      stderr,
      exitCode: e.status ?? 1
    }
  }
}

// ── Fixture helpers ───────────────────────────────────────────────────────────

interface TestProject {
  dir: string
  dbPath: string
  writeEvolution: (id: number, sql: string) => void
  writeConfig: (config: string) => void
  run: (args: string[], env?: Record<string, string>) => CliResult
}

const createTestProject = (): TestProject => {
  const dir = join(tmpdir(), `wb-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const dbPath = join(dir, "test.db")
  const evolutionsDir = join(dir, "evolutions", "default")
  mkdirSync(evolutionsDir, { recursive: true })

  const writeEvolution = (id: number, sql: string) => {
    writeFileSync(join(evolutionsDir, `${id}.sql`), sql)
  }

  const writeConfig = (config: string) => {
    writeFileSync(join(dir, "evolutions.config.ts"), config)
  }

  writeConfig(`
    export default {
      connection: { type: "sqlite" as const, path: "${dbPath.replace(/\\/g, "\\\\")}" },
      options: { dbName: "default", dbType: "sqlite" as const, evolutionsRoot: "${join(dir, "evolutions").replace(/\\/g, "\\\\")}" }
    }
  `)

  const run = (args: string[], env: Record<string, string> = {}) => runCli(args, dir, env)

  return { dir, dbPath, writeEvolution, writeConfig, run }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("db-evolutions CLI (end-to-end)", () => {
  let project: TestProject

  beforeEach(() => {
    project = createTestProject()
  })

  afterEach(() => {
    rmSync(project.dir, { recursive: true, force: true })
  })

  // ── Help & arg parsing ──────────────────────────────────────────────────

  describe("help and argument parsing", () => {
    it("prints usage and exits 0 for --help", () => {
      const result = project.run(["--help"])
      expect(result.stdout).toContain("Usage:")
      expect(result.exitCode).toBe(0)
    })

    it("prints usage and exits 1 when no command given", () => {
      const result = project.run([])
      expect(result.exitCode).toBe(1)
    })

    it("exits 1 for unknown command", () => {
      const result = project.run(["bogus"])
      expect(result.stderr).toContain("Unknown command: bogus")
      expect(result.exitCode).toBe(1)
    })
  })

  // ── apply command ─────────────────────────────────────────────────────────

  describe("apply", () => {
    it("applies evolution files and reports success", () => {
      project.writeEvolution(1, SQL_1)
      project.writeEvolution(2, SQL_2)

      const result = project.run(["apply"])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("ApplySuccessResult")
      expect(result.stderr).toContain("Applying evolution 1")
      expect(result.stderr).toContain("Applying evolution 2")

      const db = new Database(project.dbPath)
      const rows = db.prepare("SELECT * FROM db_evolutions ORDER BY id").all() as { id: number; state: string }[]
      expect(rows).toHaveLength(2)
      expect(rows.every(r => r.state === "applied")).toBe(true)

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
      expect(tables.map(t => t.name)).toContain("users")
      expect(tables.map(t => t.name)).toContain("posts")
      db.close()
    })

    it("warns clearly when no evolution files exist", () => {
      const result = project.run(["apply"])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain("No evolution files found")
      expect(result.stdout).toContain("ApplyNoopResult")
    })

    it("verbose logging shows file list and scan path", () => {
      project.writeEvolution(1, SQL_1)

      const result = project.run(["apply"])

      expect(result.stderr).toContain("Scanning")
      expect(result.stderr).toContain("Found 1 evolution file(s): 1.sql")
    })

    it("quiet mode suppresses info logging", () => {
      project.writeEvolution(1, SQL_1)

      const result = project.run(["--quiet", "apply"])

      expect(result.stderr).not.toContain("Applying evolution")
      expect(result.stdout).toContain("ApplySuccessResult")
    })

    it("is idempotent — second apply with no changes reports success", () => {
      project.writeEvolution(1, SQL_1)
      project.run(["apply"])

      const result = project.run(["apply"])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain("All evolutions up to date")
    })
  })

  // ── status command ────────────────────────────────────────────────────────

  describe("status", () => {
    it("reports no evolutions on a fresh database", () => {
      project.run(["apply"])

      const result = project.run(["status"])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("No evolutions applied")
    })

    it("reports applied count and last evolution after apply", () => {
      project.writeEvolution(1, SQL_1)
      project.writeEvolution(2, SQL_2)
      project.run(["apply"])

      const result = project.run(["status"])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("2 evolution(s) applied")
      expect(result.stdout).toContain("Last evolution: #2")
      expect(result.stdout).toContain("applied successfully")
    })

    it("reports stuck evolutions with error messages", () => {
      project.writeEvolution(1, SQL_1)
      project.run(["apply"])

      const db = new Database(project.dbPath)
      db.prepare("UPDATE db_evolutions SET state = 'applying_up', last_problem = 'column already exists' WHERE id = 1").run()
      db.close()

      const result = project.run(["status"])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("0 evolution(s) applied")
      expect(result.stdout).toContain("stuck")
      expect(result.stdout).toContain("column already exists")
    })
  })

  // ── resolve command ───────────────────────────────────────────────────────

  describe("resolve", () => {
    it("resolves a stuck applying_up evolution", () => {
      project.writeEvolution(1, SQL_1)
      project.run(["apply"])

      const db = new Database(project.dbPath)
      db.prepare("UPDATE db_evolutions SET state = 'applying_up' WHERE id = 1").run()
      db.close()

      const result = project.run(["resolve", "1"])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("ResolveSuccessResult")

      const db2 = new Database(project.dbPath)
      const row = db2.prepare("SELECT state FROM db_evolutions WHERE id = 1").get() as { state: string }
      expect(row.state).toBe("applied")
      db2.close()
    })

    it("exits 1 when no id argument given", () => {
      const result = project.run(["resolve"])
      expect(result.exitCode).toBe(1)
    })

    it("exits 1 when id is not numeric", () => {
      const result = project.run(["resolve", "abc"])
      expect(result.exitCode).toBe(1)
    })
  })

  // ── Config and connection errors ────────────────────────────────────────

  describe("config and connection errors", () => {
    it("fails clearly when no config file exists", () => {
      const emptyDir = join(tmpdir(), `wb-no-config-${Date.now()}`)
      mkdirSync(emptyDir, { recursive: true })

      const result = runCli(["apply"], emptyDir)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("No evolutions config found")
      expect(result.stderr).toContain("Searched for:")
      rmSync(emptyDir, { recursive: true, force: true })
    })

    it("fails clearly when config has a syntax error", () => {
      writeFileSync(join(project.dir, "evolutions.config.ts"), "export default {{{{ broken")

      const result = project.run(["apply"])

      expect(result.exitCode).toBe(1)
      expect(result.stderr.length).toBeGreaterThan(0)
    })

    it("fails clearly when connection config is missing required fields", () => {
      project.writeConfig(`
        export default {
          connection: { type: "postgresql" },
          options: { dbName: "default", dbType: "sqlite", evolutionsRoot: "./evolutions" }
        }
      `)

      const result = project.run(["apply"])

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain("Invalid connection config")
      expect(result.stderr).toContain("Received:")
      expect(result.stderr).toContain('"type": "postgresql"')
    })

    it("shows connection URL in stderr on startup", () => {
      project.writeEvolution(1, SQL_1)

      const result = project.run(["apply"])

      expect(result.stderr).toContain("Connecting to sqlite://")
    })

    it("loads .env file and makes variables available to config", () => {
      writeFileSync(join(project.dir, ".env"), `TEST_DB_PATH=${project.dbPath}`)
      project.writeConfig(`
        export default {
          connection: { type: "sqlite" as const, path: process.env.TEST_DB_PATH! },
          options: { dbName: "default", dbType: "sqlite" as const, evolutionsRoot: "${join(project.dir, "evolutions").replace(/\\/g, "\\\\")}" }
        }
      `)
      project.writeEvolution(1, SQL_1)

      const result = project.run(["apply"])

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain("ApplySuccessResult")
    })

    it("loads .env.local and overrides .env", () => {
      const altDbPath = join(project.dir, "alt.db")
      writeFileSync(join(project.dir, ".env"), `TEST_DB_PATH=/nonexistent/path.db`)
      writeFileSync(join(project.dir, ".env.local"), `TEST_DB_PATH=${altDbPath}`)
      project.writeConfig(`
        export default {
          connection: { type: "sqlite" as const, path: process.env.TEST_DB_PATH! },
          options: { dbName: "default", dbType: "sqlite" as const, evolutionsRoot: "${join(project.dir, "evolutions").replace(/\\/g, "\\\\")}" }
        }
      `)
      project.writeEvolution(1, SQL_1)

      const result = project.run(["apply"])

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toContain(`Connecting to sqlite://${altDbPath}`)
    })

    it("config with connectionString shows masked URL, not undefined fields", () => {
      project.writeConfig(`
        export default {
          connection: { type: "postgresql" as const, host: "localhost", port: 5432, database: "testdb", connectionString: "postgresql://myuser:secret@localhost:5432/testdb" },
          options: { dbName: "default", dbType: "postgresql" as const, evolutionsRoot: "${join(project.dir, "evolutions").replace(/\\/g, "\\\\")}" }
        }
      `)

      const result = project.run(["apply"])

      expect(result.stderr).toContain("Connecting to postgresql://***@localhost:5432/testdb")
      expect(result.stderr).not.toContain("secret")
    })
  })
})
