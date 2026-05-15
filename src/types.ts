import { z } from "zod"
import { Stream, Data, Effect } from "effect"
import { only } from "node:test"
import { UnknownException } from "effect/Cause"

// ── Domain Models ──────────────────────────────────────────────────────────────

export const evolutionStates = ["applying_up", "applied", "applying_down"] as const
export type EvolutionState = typeof evolutionStates[number]

export const evolutionState: Record<string, EvolutionState> = {
  applyingDown: "applying_down",
  applied: "applied",
  applyingUp: "applying_up",
} as const
export const evolutionStateValidator = z.enum(evolutionStates)

export const evolutionValidator = z.object({
  id: z.number(),
  up: z.string(),
  down: z.string(),
  hash: z.string()
}).strict()

export type Evolution = z.infer<typeof evolutionValidator>

export type EvolutionLazy = {
  up: Stream.Stream<string>
  down: Stream.Stream<string>
  hash: (stream: Stream.Stream<string>) => Effect.Effect<string>
}

export const evolutionRecordValidator = z.object({
  id: z.number().int().positive(),
  hash: z.string(),
  applied_at: z.coerce.date(),
  apply_script: z.string(),
  revert_script: z.string(),
  state: evolutionStateValidator,
  last_problem: z.string().nullable()
}).strict()

export type EvolutionRecord = z.infer<typeof evolutionRecordValidator>


export const dbTypes = ["postgresql", "sqlite"] as const

export const dbType: Record<typeof dbTypes[number], typeof dbTypes[number]> = {
  postgresql: "postgresql",
  sqlite: "sqlite"
} as const

export type DbType = typeof dbTypes[number]


export const postgresqlConnectionConfigValidator = z.object({
  type: z.literal("postgresql"),
  host: z.string(),
  port: z.number().int().positive().default(5432),
  database: z.string(),
  user: z.string().optional(),
  password: z.string().optional(),
  connectionString: z.string().optional(),
  ssl: z.boolean().optional()
}).strict()

export const sqliteConnectionConfigValidator = z.object({
  type: z.literal("sqlite"),
  path: z.string()
}).strict()

export const connectionConfigValidator = z.discriminatedUnion("type", [
  postgresqlConnectionConfigValidator,
  sqliteConnectionConfigValidator
])

export type PostgresqlConnectionConfig = z.infer<typeof postgresqlConnectionConfigValidator>
export type SqliteConnectionConfig = z.infer<typeof sqliteConnectionConfigValidator>
export type ConnectionConfig = z.infer<typeof connectionConfigValidator>


export const migratorOptionsValidator = z.object({
  dbName: z.string(),
  dbType: z.enum(dbTypes),
  evolutionsRoot: z.string().default("conf/evolutions"),
  tableName: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "tableName must be a valid SQL identifier")
    .default("db_evolutions"),
}).strict()

export type MigratorOptions = z.infer<typeof migratorOptionsValidator>

export type MigratorOptionsInput = z.input<typeof migratorOptionsValidator>

export const defineConfig = (config: MigratorOptionsInput): MigratorOptionsInput => config

// ── Result Types ───────────────────────────────────────────────────────────────

export interface StatusSuccessResult {
  _tag: "success"
}

export interface StatusStuckResult {
  _tag: "stuck"
  evolutionRecord: EvolutionRecord
  message: string
}

export interface StatusFailureResult {
  _tag: "failure"
  error?: string
}
export type StatusResult = StatusSuccessResult | StatusStuckResult | StatusFailureResult

export interface ApplySuccessResult {
  _tag: "ApplySuccessResult"
}

export interface ApplyFailureResult {
  _tag: "ApplyFailureResult"
  error: string
  evolutionRecord?: EvolutionRecord
}

export interface ApplyNoopResult {
  _tag: "ApplyNoopResult"
}

export type ApplyResult = ApplySuccessResult | ApplyFailureResult | ApplyNoopResult

export const applyResult = {
  success: (): ApplySuccessResult => ({ _tag: "ApplySuccessResult" }),
  /** Used when an evolution application fails. Yield the error and the evolution record that caused the error */
  // TODO should this be Evolution not EvolutionRecord here?
  failure: (error: string, evolutionRecord?: EvolutionRecord): ApplyFailureResult => ({ _tag: "ApplyFailureResult", error, evolutionRecord }),
  /** Used when there was nothing to do - all evolution have previously been applied successfully and the database is in a consistent state */
  noop: (): ApplyNoopResult => ({ _tag: "ApplyNoopResult" })
}

export interface RollbackSuccessResult {
  status: "success"
}
export interface RollbackFailureResult {
  status: "failure"
  error: string
}
export type RollbackResult = RollbackSuccessResult | RollbackFailureResult

export interface ResolveSuccessResult {
  status: "success"
  id: number
}
export interface ResolveFailureResult {
  status: "failure"
  error: string
}
export type ResolveResult = ResolveSuccessResult | ResolveFailureResult
export const resolveResult = {
  failure: (error: string): ResolveFailureResult => ({ status: "failure", error }),
  success: (id: number): ResolveSuccessResult => ({ status: "success", id })
}

// ── Errors (unexpected failures only) ─────────────────────────────────────────

export class InconsistentDatabaseError extends Error {
  constructor(public readonly stuckRecords: EvolutionRecord[]) {
    super(`${stuckRecords.length} stuck evolution(s) found. Call resolve(id) to fix.`)
    this.name = "InconsistentDatabaseError"
  }
}

export class InitializationError extends Data.TaggedError("InitializationError")<{}> { }

export class NotFoundError extends Data.TaggedError("NotFoundError")<{}> {
  constructor(public content: unknown) {
    super()
  }
}

/** 
 * Holds a record where the evlutions may have potentiall diverged 
 */
export interface DivergedEvolution {
  file: Evolution | undefined
  record: EvolutionRecord | undefined
}

/** Operations for DivergedEvolutions */
export class divergedEvolution {
  /** There's a new file and no corresponding record, means we have new files to apply */
  static isApplyUp = (x: DivergedEvolution) => {
    return !x.record && !!x.file

  }
  /** There's a file and a record with a mismatched hash, means we need to rollback past x.file.hash, and reapply up */
  static isChangedHash = (x: DivergedEvolution) => {
    return !!x.record && !!x.file
  }
  /** There's a record, and no file, means the file was removed, which we're going to treat as a rollback past x.record.hash */
  static isApplyDown = (x: DivergedEvolution) => {
    return !!x.record && !x.file
  }
  /** There's neither a record nor a file, which means the database records, and file records are matched, including potential none of either */
  static notDiverged = (x: DivergedEvolution) => {
    return !x.record && !x.file
  }

  static match(d: DivergedEvolution, callback: {
    onUp: (d: DivergedEvolution) => Effect.Effect<ApplyResult, UnknownException>
    onDownUp: (d: DivergedEvolution) => Effect.Effect<ApplyResult, UnknownException>
    onDown: (d: DivergedEvolution) => Effect.Effect<ApplyResult, UnknownException>
  }) {
    if (divergedEvolution.isApplyUp(d)) return callback.onUp(d)
    if (divergedEvolution.isChangedHash(d)) return callback.onDownUp(d)
    if (divergedEvolution.isApplyDown(d)) return callback.onDown(d)
    return Effect.succeed(applyResult.success())
  }
}
