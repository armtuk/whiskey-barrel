import { z } from "zod"

// ── Domain Models ──────────────────────────────────────────────────────────────

export const evolutionStateValidator = z.enum(["applying_up", "applied", "applying_down"])
export type EvolutionState = z.infer<typeof evolutionStateValidator>

export const evolutionValidator = z
  .object({
    id: z.number().int().positive(),
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

// ── Configuration ──────────────────────────────────────────────────────────────

export const migratorOptionsValidator = z
  .object({
    dbName: z.string(),
    dbType: z.string().optional(),
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
  status: "success"
  applied: EvolutionRecord[]
  pending: Evolution[]
  conflicts: Array<{ id: number; fileHash: string; dbHash: string }>
  stuck: EvolutionRecord[]
}
export interface StatusFailureResult {
  status: "failure"
  error: string
}
export type StatusResult = StatusSuccessResult | StatusFailureResult

export interface ApplySuccessResult {
  status: "success"
  applied: number[]
  rolledBack: number[]
}
export interface ApplyConflictResult {
  status: "conflict"
  changedAt: number
  details: string
}
export interface ApplyFailureResult {
  status: "failure"
  error: string
  stuckAt?: number
}
export type ApplyResult = ApplySuccessResult | ApplyConflictResult | ApplyFailureResult

export interface RollbackSuccessResult {
  status: "success"
  rolledBack: number[]
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

// ── Errors (unexpected failures only) ─────────────────────────────────────────

export class InconsistentDatabaseError extends Error {
  constructor(public readonly stuckRecords: EvolutionRecord[]) {
    super(`${stuckRecords.length} stuck evolution(s) found. Call resolve(id) to fix.`)
    this.name = "InconsistentDatabaseError"
  }
}
