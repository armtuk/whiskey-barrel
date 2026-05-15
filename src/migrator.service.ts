import type { MigrationDriver } from "./drivers/driver.types.js"
import { EvolutionFileService } from "./evolution-file.service.ts"
import {
  type ApplyResult,
  applyResult,
  type DbType,
  type DivergedEvolution,
  type Evolution,
  type EvolutionRecord,
  evolutionRecordValidator,
  evolutionState,
  divergedEvolution,
  InconsistentDatabaseError,
  InitializationError,
  type MigratorOptions,
  type ResolveResult,
  resolveResult,
  type RollbackResult,
  type StatusResult,
  type StatusStuckResult,
  type StatusSuccessResult,
  NotFoundError
} from "./types.js"
import { Context, Effect, Layer, Option, Stream, pipe } from "effect"
import { SqlRunner } from "./util/sql-runner.ts"
import { zodParseEffect } from "./util/zodEffectUtil.ts"
import { EvolutionRepository } from "./evolution.repository.ts"
import type { UnknownException } from "effect/Cause"
import type { ZodError } from "zod"
import type { PlatformError } from "@effect/platform/Error"
import type { EvolutionParseError } from "./evolution.parser.ts"

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
  apply: () => Effect.Effect<ApplyResult, ZodError | PlatformError | UnknownException | EvolutionParseError>,
  resolve: (id: number) => Effect.Effect<ResolveResult, UnknownException>
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

    const applyDownToDiverged = (diverged: DivergedEvolution, files: Evolution[], records: EvolutionRecord[]): Effect.Effect<ApplyResult, UnknownException> => {
      return Stream.fromIterable(
        [...records.slice(records.findIndex(x => x.hash === diverged.record?.hash))].reverse()
      ).pipe(
        Stream.tap(x => repo.startDevolution(x)),
        Stream.tap(x => sqlRunner.exec(x.revert_script)),
        Stream.tap(x => sqlRunner.exec(`delete from ${options.tableName} where hash = ?`, [x.hash])),
        Stream.runDrain,
        Effect.map(x => applyResult.success())
      )
    }

    const applyUpFromDiverged = (diverged: DivergedEvolution, files: Evolution[], records: EvolutionRecord[]) => {
      return Stream.fromIterable(
        // findIndex will give the first index where recores and file mismatch, which, should be the file file to apply
        files.slice(files.findIndex(x => x.hash === diverged.file?.hash))
      ).pipe(
        Stream.tap(x => repo.startEvolution(x)),
        Stream.tap(x => sqlRunner.exec(x.up)),
        Stream.tap(x => repo.setApplied(x)), // I'm imagining this will error here if there was a problem and stop
        Stream.runDrain,
        Effect.map(_ => applyResult.success())
      )
    }

    const apply = (): Effect.Effect<ApplyResult, UnknownException | ZodError | PlatformError | EvolutionParseError> => Effect.gen(function* () {
      yield* initialize()

      // TODO see if we can decompose this
      const x = yield* status()
      if (x._tag === "stuck") {
        return applyResult.failure(
          x.message,
          x.evolutionRecord
        )
      }
      if (x._tag === "failure") {
        return applyResult.failure(
          x.error || "Unknown error applying evolutions"
        )
      }

      const files = yield* fileService.fetchEvolutions()
      const records = yield* fetchAllRecords()

      return yield* Option.match(findFirstDivergence(files, records), {
        onSome: v => divergedEvolution.match(v, {
          onUp: d => applyUpFromDiverged(d, files, records),
          onDown: d => applyDownToDiverged(d, files, records),
          onDownUp: d => pipe(
            applyDownToDiverged(d, files, records),
            Effect.flatMap(_ => applyUpFromDiverged(d, files, records))
          )
        }),
        onNone: () => Effect.succeed(applyResult.success())
      })
    })

    const findFirstDivergence = (files: Evolution[], records: EvolutionRecord[]): Option.Option<DivergedEvolution> => {
      const paired: DivergedEvolution[] = Array.from(files, (val, i) => ({ file: val, record: records[i] }))
      const unmatched: DivergedEvolution | undefined = paired.find(x => x.file?.hash !== x.record?.hash)
      return Option.fromNullable(unmatched)
    }

    const rollback = () => Effect.gen(function* () {
      yield* initialize()

      const last = yield* pipe(
        fetchAllRecords(),
        Effect.flatMap(rows => rows.length === 0 ? Effect.fail(new NotFoundError("No evolutions to roll back")) : Effect.succeed(rows.slice(-1)[0])),
        Effect.tap(revert => sqlRunner.exec(`UPDATE ${options.tableName} SET state = 'applying_down' WHERE id = ?`, [revert.id])),
        Effect.tap(revert => sqlRunner.exec(revert.revert_script)),
        Effect.tap(revert => sqlRunner.query(`DELETE FROM ${options.tableName} WHERE id = ?`, [revert.id])),
      )

      return { status: "success", rolledBack: [last.id] }
    })

    const resolve = (id: number): Effect.Effect<ResolveResult, UnknownException> => Effect.gen(function* () {
      const r: Option.Option<EvolutionRecord> = yield* repo.findById(id)

      return yield* Option.match(r, {
        onNone: () => Effect.succeed(resolveResult.failure(`Evolution ${id} not found`)),
        onSome: (value) => Effect.gen(function* () {
          if (value.state === evolutionState.applyingUp) {
            yield* sqlRunner.query(`update ${options.tableName} set state = ?, last_problem = null where id = ?`, [evolutionState.applied, value.id])
            return resolveResult.success(id)
          }
          else if (value.state === evolutionState.applyingDown) {
            yield* sqlRunner.query(`delete from ${options.tableName} where id = ?`, [value.id])
            return resolveResult.success(id)
          } else {
            return resolveResult.failure(`Evolution ${value.id} is not stuck (state: ${value.state})`)
          }
        })
      })

    })

    return { apply, resolve }
  })
)
