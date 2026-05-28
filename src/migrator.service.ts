import type { PlatformError } from "@effect/platform/Error"
import { Context, Effect, Layer, Logger, LogLevel, Option, pipe } from "effect"
import type { UnknownException } from "effect/Cause"
import type { ZodError } from "zod"
import type { EvolutionParseError } from "./evolution.parser.ts"
import { EvolutionRepository } from "./evolution.repository.ts"
import { EvolutionFileService } from "./evolution-file.service.ts"
import {
  type ApplyResult,
  applyResult,
  type DbType,
  type DivergedEvolution,
  divergedEvolution,
  type Evolution,
  type EvolutionRecord,
  evolutionRecordValidator,
  evolutionState,
  extractErrorMessage,
  MigrationExecError,
  type MigratorOptions,
  NotFoundError,
  type ResolveResult,
  resolveResult,
  type StatusResult,
  type StatusStuckResult,
  type StatusSuccessResult
} from "./types.ts"
import { SqlRunner } from "./util/sql-runner.ts"
import { zodParseEffect } from "./util/zodEffectUtil.ts"

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
export class MigratorService extends Context.Tag("MigratorService")<
  MigratorService,
  {
    apply: () => Effect.Effect<ApplyResult, ZodError | PlatformError | UnknownException | EvolutionParseError>
    resolve: (id: number) => Effect.Effect<ResolveResult, UnknownException>
  }
>() {}

// ── Service ────────────────────────────────────────────────────────────────────
export const MigratorServiceLive = (options: MigratorOptions) => {
  const logLevel = options.quiet ? LogLevel.Warning : LogLevel.Info
  return Layer.effect(
    MigratorService,
    Effect.gen(function* () {
      const fileService = yield* EvolutionFileService
      const sqlRunner = yield* SqlRunner
      const repo = yield* EvolutionRepository

      const initialize = () =>
        Effect.gen(function* () {
          const template = inits[options.dbType]

          const sql = template.replace(/db_evolutions/g, options.tableName)

          yield* sqlRunner.exec(sql)
        })

      const status = (): Effect.Effect<StatusResult, UnknownException, never> => {
        return pipe(
          sqlRunner.query<EvolutionRecord>(`select * from ${options.tableName} where state in (?, ?) order by id asc limit 1`, [
            evolutionState.applyingUp,
            evolutionState.applyingDown
          ]),
          Effect.map(rows => {
            if (rows.length === 0) {
              return { _tag: "success" } as StatusSuccessResult
            } else {
              return {
                _tag: "stuck",
                message: rows[0].last_problem || `Unknown Problem Occurred applying evolution ID ${rows[0].id}`,
                evolutionRecord: rows[0]
              } as StatusStuckResult
            }
          })
        )
      }

      const fetchAllRecords = (): Effect.Effect<EvolutionRecord[], UnknownException | ZodError, never> =>
        sqlRunner
          .query<unknown>(`SELECT * FROM ${options.tableName} ORDER BY id`)
          .pipe(Effect.flatMap(rows => Effect.forEach(rows, zodParseEffect(evolutionRecordValidator))))

      const applyOneUp = (x: Evolution) =>
        pipe(
          repo.startEvolution(x),
          Effect.andThen(() =>
            sqlRunner.exec(x.up).pipe(
              Effect.catchAll(err => {
                const msg = extractErrorMessage(err)
                return pipe(
                  repo.recordError(x.id, msg),
                  Effect.catchAll(() => Effect.void),
                  Effect.andThen(() => Effect.fail(new MigrationExecError({ evolutionId: x.id, direction: "up", detail: msg })))
                )
              })
            )
          ),
          Effect.andThen(() => repo.setApplied(x))
        )

      const rollbackOneDown = (x: EvolutionRecord) =>
        pipe(
          repo.startDevolution(x),
          Effect.andThen(() =>
            sqlRunner.exec(x.revert_script).pipe(
              Effect.catchAll(err => {
                const msg = extractErrorMessage(err)
                return pipe(
                  repo.recordError(x.id, msg),
                  Effect.catchAll(() => Effect.void),
                  Effect.andThen(() => Effect.fail(new MigrationExecError({ evolutionId: x.id, direction: "down", detail: msg })))
                )
              })
            )
          ),
          Effect.andThen(() => sqlRunner.exec(`delete from ${options.tableName} where id = ?`, [x.id]))
        )

      const applyDownToDiverged = (
        diverged: DivergedEvolution,
        _files: Evolution[],
        records: EvolutionRecord[]
      ): Effect.Effect<ApplyResult, UnknownException> => {
        const toRollback = [...records.slice(records.findIndex(x => x.hash === diverged.record?.hash))].reverse()
        return pipe(
          Effect.forEach(toRollback, x =>
            pipe(
              Effect.logInfo(`Rolling back evolution ${x.id}`),
              Effect.andThen(() => rollbackOneDown(x))
            )
          ),
          Effect.map(() => applyResult.success() as ApplyResult),
          Effect.catchTag("MigrationExecError", err => Effect.succeed(applyResult.failure(err.message) as ApplyResult))
        )
      }

      const applyUpFromDiverged = (diverged: DivergedEvolution, files: Evolution[], _records: EvolutionRecord[]) => {
        const toApply = files.slice(files.findIndex(x => x.hash === diverged.file?.hash))
        return pipe(
          Effect.forEach(toApply, x =>
            pipe(
              Effect.logInfo(`Applying evolution ${x.id}`),
              Effect.andThen(() => applyOneUp(x))
            )
          ),
          Effect.map(() => applyResult.success() as ApplyResult),
          Effect.catchTag("MigrationExecError", err => Effect.succeed(applyResult.failure(err.message) as ApplyResult))
        )
      }

      const apply = (): Effect.Effect<ApplyResult, UnknownException | ZodError | PlatformError | EvolutionParseError> =>
        Effect.gen(function* () {
          yield* initialize()
          yield* Effect.logInfo(`Initialized table ${options.tableName}`)

          const x = yield* status()
          if (x._tag === "stuck") {
            return applyResult.failure(x.message, x.evolutionRecord)
          }
          if (x._tag === "failure") {
            return applyResult.failure(x.error || "Unknown error applying evolutions")
          }
          yield* Effect.logInfo("Database state is clean")

          yield* Effect.logInfo(`Scanning ${options.evolutionsRoot}/${options.dbName} for evolution files`)
          const files = yield* fileService.fetchEvolutions()
          if (files.length === 0) {
            yield* Effect.logWarning(`No evolution files found in ${options.evolutionsRoot}/${options.dbName} — nothing to apply`)
            return applyResult.noop()
          }
          yield* Effect.logInfo(`Found ${files.length} evolution file(s): ${files.map(f => `${f.id}.sql`).join(", ")}`)

          const records = yield* fetchAllRecords()
          yield* Effect.logInfo(`${records.length} evolution(s) already applied`)

          return yield* Option.match(findFirstDivergence(files, records), {
            onSome: v =>
              divergedEvolution.match(v, {
                onUp: d => applyUpFromDiverged(d, files, records),
                onDown: d => applyDownToDiverged(d, files, records),
                onDownUp: d =>
                  pipe(
                    applyDownToDiverged(d, files, records),
                    Effect.flatMap(result =>
                      result._tag === "ApplyFailureResult" ? Effect.succeed(result) : applyUpFromDiverged(d, files, records)
                    )
                  )
              }),
            onNone: () => Effect.logInfo("All evolutions up to date").pipe(Effect.map(() => applyResult.success()))
          })
        })

      const findFirstDivergence = (files: Evolution[], records: EvolutionRecord[]): Option.Option<DivergedEvolution> => {
        const maxLen = Math.max(files.length, records.length)
        const paired: DivergedEvolution[] = Array.from({ length: maxLen }, (_, i) => ({
          file: files[i] as Evolution | undefined,
          record: records[i] as EvolutionRecord | undefined
        }))
        const unmatched: DivergedEvolution | undefined = paired.find(x => x.file?.hash !== x.record?.hash)
        return Option.fromNullable(unmatched)
      }

      const _rollback = () =>
        Effect.gen(function* () {
          yield* initialize()

          const last = yield* pipe(
            fetchAllRecords(),
            Effect.flatMap(rows =>
              rows.length === 0
                ? Effect.fail(new NotFoundError({ content: "No evolutions to roll back" }))
                : Effect.succeed(rows.slice(-1)[0])
            ),
            Effect.tap(revert => Effect.logInfo(`Rolling back evolution ${revert.id}`)),
            Effect.tap(revert => sqlRunner.exec(`UPDATE ${options.tableName} SET state = 'applying_down' WHERE id = ?`, [revert.id])),
            Effect.tap(revert => sqlRunner.exec(revert.revert_script)),
            Effect.tap(revert => sqlRunner.query(`DELETE FROM ${options.tableName} WHERE id = ?`, [revert.id]))
          )

          return { _tag: "RollbackSuccessResult" as const, rolledBack: [last.id] }
        })

      const resolve = (id: number): Effect.Effect<ResolveResult, UnknownException> =>
        Effect.gen(function* () {
          yield* initialize()
          const r: Option.Option<EvolutionRecord> = yield* repo.findById(id)

          return yield* Option.match(r, {
            onNone: () => Effect.succeed(resolveResult.failure(`Evolution ${id} not found`)),
            onSome: value =>
              Effect.gen(function* () {
                if (value.state === evolutionState.applyingUp) {
                  yield* sqlRunner.query(`update ${options.tableName} set state = ?, last_problem = null where id = ?`, [
                    evolutionState.applied,
                    value.id
                  ])
                  yield* Effect.logInfo(`Resolved evolution ${id} (was applying_up → applied)`)
                  return resolveResult.success(id)
                } else if (value.state === evolutionState.applyingDown) {
                  yield* sqlRunner.query(`delete from ${options.tableName} where id = ?`, [value.id])
                  yield* Effect.logInfo(`Resolved evolution ${id} (was applying_down → removed)`)
                  return resolveResult.success(id)
                } else {
                  return resolveResult.failure(`Evolution ${value.id} is not stuck (state: ${value.state})`)
                }
              })
          })
        })

      return { apply, resolve }
    })
  ).pipe(
    Layer.provide(Logger.minimumLogLevel(logLevel)),
    Layer.provide(
      Logger.replace(
        Logger.defaultLogger,
        Logger.make(({ message }) => {
          const text = Array.isArray(message) ? message.join(" ") : String(message)
          process.stderr.write(`${text}\n`)
        })
      )
    )
  )
}
