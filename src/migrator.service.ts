import type { MigrationDriver } from "./drivers/driver.types.js"
import { EvolutionFileService } from "./evolution.file.service.js"
import {
  type ApplyResult,
  applyResult,
  DbType,
  type Evolution,
  type EvolutionRecord,
  evolutionRecordValidator,
  evolutionState,
  InconsistentDatabaseError,
  InitializationError,
  type MigratorOptions,
  type ResolveResult,
  resolveResult,
  type RollbackResult,
  type StatusResult,
  StatusStuckResult,
  StatusSuccessResult
} from "./types.js"
import { Context, Effect, Layer, Option, Stream, pipe } from "effect"
import { SqlRunner } from "./util/sql-runner.ts"
import { zodParseEffect } from "./util/zodEffectUtil.ts"
import { EvolutionRepository } from "./evolution.repository.ts"
import { UnknownException } from "effect/Cause"
import { ZodError } from "zod"

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

const inits: Record<DbType, string> = {
  sqlite: INIT_SQLITE,
  postgresql: INIT_POSTGRESQL
} as const


// Service Tag
export class MigratorService extends Context.Tag("MigratorService")<MigratorService, {
  apply: () => Effect.Effect<ApplyResult>
}>() { }


// ── Service ────────────────────────────────────────────────────────────────────
export const MigratorServiceLive = (options: MigratorOptions) => Layer.effect(
  MigratorService,
  Effect.gen(function* () {
    const fileService = yield* EvolutionFileService
    const sqlRunner = yield* SqlRunner
    const repo = yield* EvolutionRepository

    const initialize = () => Effect.gen(function* () {
      const template = inits[options.dbType]

      const sql = template.replace(/db_evolutions/g, options.tableName)

      yield* sqlRunner.exec(sql)
    })

    const status = (): Effect.Effect<StatusResult, UnknownException, never> => {
      return pipe(
        sqlRunner.query<EvolutionRecord>(`select * from ${options.tableName} where state in (?, ?) order by id asc limit 1`, [evolutionState.applyingUp, evolutionState.applyingDown]),
        Effect.map(rows => {
          if (rows.length == 0) {
            return { _tag: "success" } as StatusSuccessResult
          }
          else {
            return { _tag: "stuck", message: rows[0].last_problem || `Unknown Problem Occurred applying evolution ID ${rows[0].id}`, evolutionRecord: rows[0] } as StatusStuckResult
          }
        })
      )
    }

    const fetchAllRecords = (): Effect.Effect<EvolutionRecord[], UnknownException | ZodError, never> =>
      sqlRunner.queryStream(`SELECT * FROM ${options.tableName} ORDER BY id`).pipe(
        Stream.mapEffect(zodParseEffect(evolutionRecordValidator)),
        Stream.runCollect,
        Effect.map(chunk => Array.from(chunk))
      )

    const apply = (): Effect.Effect<ApplyResult> => Effect.gen(function* () {
      yield* initialize()

      // TODO see if we can decompose this
      const x = yield* status()
      if (x._tag === "stuck") {
        return yield* Effect.fail(applyResult.failure(
          x.message,
          x.evolutionRecord
        ))
      }
      if (x._tag === "failure") {
        return yield* Effect.fail(applyResult.failure(
          x.error || "Unknown error applying evolutions"
        ))
      }

      const files = yield* fileService.fetchEvolutions()
      const records = yield* fetchAllRecords()

      const diverged = findFirstDivergence(files, records).flatMap(v => v)
      if (diverged[0] !== null && !options.autoApply) {
        return { status: "conflict", changedAt: changeId, details: `Evolution ${changeId} hash has changed` }
      }

      const plan = buildPlan(files, records, changeId)
      if (plan.downs.length === 0 && plan.ups.length === 0) {
        return { status: "success", applied: [], rolledBack: [] }
      }

      return executePlan(plan)
    })

    const findFirstDivergence = (files: Evolution[], records: EvolutionRecord[]): Option.Option<[Evolution | undefined, EvolutionRecord | undefined]> => {
      const paired = Array.from(files, (val, i) => [val, records[i]])
      return Option.fromNullable(paired.find(([a, b]) => a?.hash !== b?.hash))
    }

    const rollback = () => Effect.gen(function* () {
      yield* initialize()

      yield* pipe(
        fetchAllRecords(),
        Effect.map(x => x.slice(-1)[0]),
        Effect.tap(revert => sqlRunner.exec(`UPDATE ${options.tableName} SET state = 'applying_down' WHERE id = ?`, [revert.id])),
        Effect.flatMap(revert => {
          return pipe(revert,
            sqlRunner.exec(revert.revert_script)
          )
        })
        Effect.tap(revert => sqlRunner.query(`DELETE FROM ${options.tableName} WHERE id = ?`, [last.id])),
      )

      return { status: "success", rolledBack: [last.id] }
    })

    const resolve = (id: number): Effect.Effect<ResolveResult, never, SqlRunner> => Effect.gen(function* () {
      const sql = yield* SqlRunner

      const r: EvolutionRecord[] = yield* sql.query<EvolutionRecord>(`select * from ${self.table} where id = :id`, { id })

      if (!r) return resolveResult.failure(`Evolution ${id} not found`)

      if (r.state === "applying_up") {
        await this.driver.query(`UPDATE ${this.table} SET state = 'applied', last_problem = NULL WHERE id = ?`, [id])
        return { status: "success", id }
      } else if (record.state === "applying_down") {
        await this.driver.query(`DELETE FROM ${this.table} WHERE id = ?`, [id])
        return { status: "success", id }
      } else {
        return { status: "failure", error: `Evolution ${id} is not stuck (state: ${record.state})` }
      }
    })

    const executePlan = (plan: MigrationPlan): EvolutionRecord[] => {
      records.filter(r => r.state === "applying_up" || r.state === "applying_down")
    }

    return { apply }
  })

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
