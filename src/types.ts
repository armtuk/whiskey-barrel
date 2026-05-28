import { Data, Effect } from "effect"
import type { UnknownException } from "effect/Cause"
import { z } from "zod"

// ── Domain Models ──────────────────────────────────────────────────────────────

export const evolutionStates = ["applying_up", "applied", "applying_down"] as const
export type EvolutionState = (typeof evolutionStates)[number]

export const evolutionState: Record<string, EvolutionState> = {
  applyingDown: "applying_down",
  applied: "applied",
  applyingUp: "applying_up"
} as const
export const evolutionStateValidator = z.enum(evolutionStates)

export const evolutionValidator = z
  .object({
    id: z.number(),
    up: z.string(),
    down: z.string(),
    hash: z.string()
  })
  .strict()

export type Evolution = z.infer<typeof evolutionValidator>

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

export const dbTypes = ["postgresql", "sqlite"] as const

export const dbType: Record<(typeof dbTypes)[number], (typeof dbTypes)[number]> = {
  postgresql: "postgresql",
  sqlite: "sqlite"
} as const

export type DbType = (typeof dbTypes)[number]

export const connectionConfigValidator = z.string().url().refine(
  (url) => {
    const scheme = new URL(url).protocol
    return scheme === "postgresql:" || scheme === "postgres:" || scheme === "sqlite:"
  },
  { message: "Connection URL must use postgresql://, postgres://, or sqlite:// scheme" }
)

export type ConnectionConfig = z.infer<typeof connectionConfigValidator>

export const parseConnectionUrl = (url: string): { scheme: "postgresql" | "sqlite"; url: URL } => {
  const parsed = new URL(url)
  const scheme = parsed.protocol === "sqlite:" ? "sqlite" as const : "postgresql" as const
  return { scheme, url: parsed }
}

export const describeConnectionUrl = (url: string): string => {
  const parsed = new URL(url)
  if (parsed.password) {
    return url.replace(`:${parsed.password}@`, ":***@")
  }
  return url
}

export const migratorOptionsValidator = z
  .object({
    dbName: z.string(),
    dbType: z.enum(dbTypes),
    evolutionsRoot: z.string().default("conf/evolutions"),
    tableName: z
      .string()
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "tableName must be a valid SQL identifier")
      .default("db_evolutions"),
    quiet: z.boolean().default(false)
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

export interface ApplyNoopResult {
  _tag: "ApplyNoopResult"
}

export type ApplyResult = ApplySuccessResult | ApplyFailureResult | ApplyNoopResult

export const applyResult = {
  success: (): ApplySuccessResult => ({ _tag: "ApplySuccessResult" }),
  /** Used when an evolution application fails. Yield the error and the evolution record that caused the error */
  // TODO should this be Evolution not EvolutionRecord here?
  failure: (error: string, evolutionRecord?: EvolutionRecord): ApplyFailureResult => ({
    _tag: "ApplyFailureResult",
    error,
    evolutionRecord
  }),
  /** Used when there was nothing to do - all evolution have previously been applied successfully and the database is in a consistent state */
  noop: (): ApplyNoopResult => ({ _tag: "ApplyNoopResult" })
}

export interface RollbackSuccessResult {
  _tag: "RollbackSuccessResult"
}
export interface RollbackFailureResult {
  _tag: "RollbackFailureResult"
  error: string
}
export type RollbackResult = RollbackSuccessResult | RollbackFailureResult

export interface ResolveSuccessResult {
  _tag: "ResolveSuccessResult"
  id: number
}
export interface ResolveFailureResult {
  _tag: "ResolveFailureResult"
  error: string
}
export type ResolveResult = ResolveSuccessResult | ResolveFailureResult
export const resolveResult = {
  failure: (error: string): ResolveFailureResult => ({ _tag: "ResolveFailureResult", error }),
  success: (id: number): ResolveSuccessResult => ({ _tag: "ResolveSuccessResult", id })
}

// ── Errors (unexpected failures only) ─────────────────────────────────────────

export class InconsistentDatabaseError extends Error {
  constructor(public readonly stuckRecords: EvolutionRecord[]) {
    super(`${stuckRecords.length} stuck evolution(s) found. Call resolve(id) to fix.`)
    this.name = "InconsistentDatabaseError"
  }
}

export class InitializationError extends Data.TaggedError("InitializationError")<{}> {}

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly content: unknown
}> {}

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
  static isChangedHash = (x: DivergedEvolution) => {
    return !!x.record && !!x.file && x.record.hash !== x.file.hash
  }
  /** There's a record, and no file, means the file was removed, which we're going to treat as a rollback past x.record.hash */
  static isApplyDown = (x: DivergedEvolution) => {
    return !!x.record && !x.file
  }
  /** There's neither a record nor a file, which means the database records, and file records are matched, including potential none of either */
  static notDiverged = (x: DivergedEvolution) => {
    return !x.record && !x.file
  }

  static match(
    d: DivergedEvolution,
    callback: {
      onUp: (d: DivergedEvolution) => Effect.Effect<ApplyResult, UnknownException>
      onDownUp: (d: DivergedEvolution) => Effect.Effect<ApplyResult, UnknownException>
      onDown: (d: DivergedEvolution) => Effect.Effect<ApplyResult, UnknownException>
    }
  ) {
    if (divergedEvolution.isApplyUp(d)) return callback.onUp(d)
    if (divergedEvolution.isChangedHash(d)) return callback.onDownUp(d)
    if (divergedEvolution.isApplyDown(d)) return callback.onDown(d)
    return Effect.succeed(applyResult.success())
  }
}
