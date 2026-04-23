import type { MigrationDriver } from "./drivers/driver.types.js"
import { EvolutionFileService } from "./evolution.file.service.js"
import {
  type ApplyResult,
  type Evolution,
  type EvolutionRecord,
  evolutionRecordValidator,
  InconsistentDatabaseError,
  type MigratorOptions,
  type ResolveResult,
  type RollbackResult,
  type StatusResult
} from "./types.js"

// ── Init SQL (inlined to avoid runtime file-loading complexity in dual ESM/CJS) ─

const INIT_SQLITE = `
CREATE TABLE IF NOT EXISTS db_evolutions (
  id             INTEGER      NOT NULL PRIMARY KEY,
  hash           VARCHAR(64)  NOT NULL,
  applied_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  apply_script   TEXT,
  revert_script  TEXT,
  state          VARCHAR(32)  NOT NULL,
  last_problem   TEXT
)`

const INIT_POSTGRESQL = `
CREATE TABLE IF NOT EXISTS db_evolutions (
  id             INTEGER      NOT NULL PRIMARY KEY,
  hash           VARCHAR(64)  NOT NULL,
  applied_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  apply_script   TEXT,
  revert_script  TEXT,
  state          VARCHAR(32)  NOT NULL,
  last_problem   TEXT
)`

// ── Service ────────────────────────────────────────────────────────────────────

export class MigratorService {
  private readonly fileService: EvolutionFileService
  private readonly table: string

  constructor(
    private readonly driver: MigrationDriver,
    private readonly options: MigratorOptions
  ) {
    this.fileService = new EvolutionFileService(options)
    this.table = options.tableName
  }

  async apply(): Promise<ApplyResult> {
    // GATHER
    await this.initialize()
    const files = this.fileService.fetchEvolutions()
    const records = await this.fetchAllRecords()

    // COMPUTE
    const stuck = findStuck(records)
    if (stuck.length > 0) throw new InconsistentDatabaseError(stuck)

    const changeId = findFirstDivergence(files, records)
    if (changeId !== null && !this.options.autoApply) {
      return { status: "conflict", changedAt: changeId, details: `Evolution ${changeId} hash has changed` }
    }

    const plan = buildPlan(files, records, changeId)
    if (plan.downs.length === 0 && plan.ups.length === 0) {
      return { status: "success", applied: [], rolledBack: [] }
    }

    // PERSIST
    return this.executePlan(plan)
  }

  async status(): Promise<StatusResult> {
    // GATHER — read-only, never mutates db_evolutions
    await this.initialize()
    const files = this.fileService.fetchEvolutions()
    const records = await this.fetchAllRecords()

    // COMPUTE
    const stuck = findStuck(records)
    const recordMap = new Map(records.map(r => [r.id, r]))
    const appliedIds = new Set(records.filter(r => r.state === "applied").map(r => r.id))

    const conflicts = files.reduce<Array<{ id: number; fileHash: string; dbHash: string }>>((acc, f) => {
      const r = recordMap.get(f.id)
      if (r && r.hash !== f.hash) acc.push({ id: f.id, fileHash: f.hash, dbHash: r.hash })
      return acc
    }, [])

    const pending = files.filter(f => !recordMap.has(f.id))
    const applied = records.filter(r => appliedIds.has(r.id))

    return { status: "success", applied, pending, conflicts, stuck }
  }

  async rollback(): Promise<RollbackResult> {
    // GATHER
    await this.initialize()
    const records = await this.fetchAllRecords()

    // COMPUTE
    const stuck = findStuck(records)
    if (stuck.length > 0) throw new InconsistentDatabaseError(stuck)

    const last = records.filter(r => r.state === "applied").at(-1)
    if (!last) return { status: "success", rolledBack: [] }

    // PERSIST
    try {
      await this.driver.query(`UPDATE ${this.table} SET state = 'applying_down' WHERE id = ?`, [last.id])
      await this.driver.exec(last.revert_script)
      await this.driver.query(`DELETE FROM ${this.table} WHERE id = ?`, [last.id])
      return { status: "success", rolledBack: [last.id] }
    } catch (err) {
      return { status: "failure", error: err instanceof Error ? err.message : String(err) }
    }
  }

  async resolve(id: number): Promise<ResolveResult> {
    const records = await this.fetchAllRecords()
    const record = records.find(r => r.id === id)

    if (!record) return { status: "failure", error: `Evolution ${id} not found` }

    if (record.state === "applying_up") {
      await this.driver.query(`UPDATE ${this.table} SET state = 'applied', last_problem = NULL WHERE id = ?`, [id])
      return { status: "success", id }
    } else if (record.state === "applying_down") {
      await this.driver.query(`DELETE FROM ${this.table} WHERE id = ?`, [id])
      return { status: "success", id }
    } else {
      return { status: "failure", error: `Evolution ${id} is not stuck (state: ${record.state})` }
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async initialize(): Promise<void> {
    const template = this.options.dbType === "postgresql" ? INIT_POSTGRESQL : INIT_SQLITE
    const sql = template.replace(/db_evolutions/g, this.table)
    await this.driver.exec(sql)
  }

  private async fetchAllRecords(): Promise<EvolutionRecord[]> {
    const rows = await this.driver.query<Record<string, unknown>>(
      `SELECT id, hash, applied_at, apply_script, revert_script, state, last_problem FROM ${this.table} ORDER BY id`
    )
    return rows.map(row => evolutionRecordValidator.parse(row))
  }

  private async executePlan(plan: MigrationPlan): Promise<ApplyResult> {
    const rolledBack: number[] = []
    const applied: number[] = []

    try {
      for (const record of plan.downs) {
        // biome-ignore lint/performance/noAwaitInLoops: rollbacks must execute sequentially high → low
        await this.driver.query(`UPDATE ${this.table} SET state = 'applying_down' WHERE id = ?`, [record.id])
        await this.driver.exec(record.revert_script)
        await this.driver.query(`DELETE FROM ${this.table} WHERE id = ?`, [record.id])
        rolledBack.push(record.id)
      }

      for (const file of plan.ups) {
        // biome-ignore lint/performance/noAwaitInLoops: migrations must execute sequentially low → high
        await this.driver.query(
          `INSERT INTO ${this.table} (id, hash, applied_at, apply_script, revert_script, state, last_problem) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, 'applying_up', NULL)`,
          [file.id, file.hash, file.up, file.down]
        )
        await this.driver.exec(file.up)
        await this.driver.query(`UPDATE ${this.table} SET state = 'applied' WHERE id = ?`, [file.id])
        applied.push(file.id)
      }
    } catch (err) {
      return { status: "failure", error: err instanceof Error ? err.message : String(err) }
    }

    return { status: "success", applied, rolledBack }
  }
}

// ── Pure helpers (Compute phase — no IO) ──────────────────────────────────────

interface MigrationPlan {
  downs: EvolutionRecord[] // sorted high → low
  ups: Evolution[] // sorted low → high
}

const findStuck = (records: EvolutionRecord[]): EvolutionRecord[] =>
  records.filter(r => r.state === "applying_up" || r.state === "applying_down")

const findFirstDivergence = (files: Evolution[], records: EvolutionRecord[]): number | null => {
  const recordMap = new Map(records.map(r => [r.id, r]))
  for (const file of files) {
    const record = recordMap.get(file.id)
    if (record && record.hash !== file.hash) return file.id
  }
  return null
}

const buildPlan = (files: Evolution[], records: EvolutionRecord[], changeId: number | null): MigrationPlan => {
  if (changeId === null) {
    const appliedIds = new Set(records.map(r => r.id))
    return { downs: [], ups: files.filter(f => !appliedIds.has(f.id)) }
  }
  return {
    downs: records.filter(r => r.id >= changeId).sort((a, b) => b.id - a.id),
    ups: files.filter(f => f.id >= changeId)
  }
}
