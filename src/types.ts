import { z } from "zod"
import { Stream, Data, Effect } from "effect"
import { only } from "node:test"

// ── Domain Models ──────────────────────────────────────────────────────────────

export const evolutionStates: Array<string> = ["applying_up", "applied", "applying_down"] as const
type EvolutionState = typeof evolutionStates[number]

export const evolutionState: Record<string, EvolutionState> = {
  applyingDown: "applying_down",
  applied: "applied",
  applyingUp: "applying_up",
} as const
export const evolutionStateValidator = z.enum(evolutionStates)

export const evolutionValidator = z.object({
  up: z.string(),
  down: z.string(),
  hash: z.string()
})
  .strict()
export type Evolution = z.infer<typeof evolutionValidator>

export type EvolutionLazy = {
  up: Stream.Stream<string>
  down: Stream.Stream<string>
  hash: (stream: Stream.Stream<string>) => Effect.Effect<string>
}

export const evolutionRecordValidator = z
  .object({
    id: z.number().int().positive(),
    hash: z.string(),
    applied_at: z.coerce.date(),
    apply_script: z.string(),
    revert_script: z.string(),
    state: evolutionStateValidator,
    last_problem: z.string().nullable()
  })
  .strict()
export type EvolutionRecord = z.infer<typeof evolutionRecordValidator>

// ── Configuration ──────────────────────────────────────────────────────────────

export const dbTypes = ["postgresql", "sqlite"] as const

export const dbType: Record<typeof dbTypes[number], typeof dbTypes[number]> = {
  postgresql: "postgresql",
  sqlite: "sqlite"
} as const

export type DbType = typeof dbTypes[number]

// ── Connection Config ─────────────────────────────────────────────────────────

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


export const migratorOptionsValidator = z
  .object({
    dbName: z.string(),
    dbType: z.enum(dbTypes),
    evolutionsRoot: z.string().default("conf/evolutions"),
    tableName: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "tableName must be a valid SQL identifier")
      .default("db_evolutions"),
    autoApply: z.boolean().default(false)
  })
  .strict()

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

export type ApplyResult = ApplySuccessResult | ApplyFailureResult

export const applyResult = {
  success: () => { _tag: "ApplySuccessResult" },
  failure: (error: string, evolutionRecord?: EvolutionRecord) => ({ _tag: "ApplyFailureResult", error, evolutionRecord })
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
  failure: (error: string) => ({ status: "failure", error }),
  success: (id: number) => ({ status: "success", id })
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
