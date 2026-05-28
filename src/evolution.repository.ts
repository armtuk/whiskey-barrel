import { Context, Effect, Layer, Option } from "effect"
import type { UnknownException } from "effect/Cause"
import { type Evolution, type EvolutionRecord, type EvolutionState, evolutionState } from "./types.ts"
import { SqlRunner } from "./util/sql-runner.ts"

export class EvolutionRepository extends Context.Tag("EvolutionRepository")<
  EvolutionRepository,
  {
    findById(id: number): Effect.Effect<Option.Option<EvolutionRecord>, UnknownException>
    setApplied(r: Evolution | EvolutionRecord): Effect.Effect<void, UnknownException>
    startEvolution(r: Evolution): Effect.Effect<void, UnknownException>
    startDevolution(r: Evolution | EvolutionRecord): Effect.Effect<void, UnknownException>
    recordError(id: number, error: string): Effect.Effect<void, UnknownException>
  }
>() {}

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export const EvolutionRepositoryLive = (tableName: string) =>
  Layer.effect(
    EvolutionRepository,
    Effect.gen(function* () {
      if (!TABLE_NAME_RE.test(tableName)) {
        return yield* Effect.die(new Error(`Invalid tableName: ${tableName}`))
      }
      const sqlRunner = yield* SqlRunner

      const applyState = (id: number, state: EvolutionState) =>
        sqlRunner.exec(`update ${tableName} set state = ? where id = ?`, [state, id])

      return {
        findById: (id: number) =>
          sqlRunner
            .query<EvolutionRecord>(`select * from ${tableName} where id = ?`, [id])
            .pipe(Effect.map(rows => Option.fromNullable(rows[0]))),
        startEvolution: (r: Evolution) =>
          sqlRunner.exec(`insert into ${tableName} (id, hash, apply_script, revert_script, state) values (?, ?, ?, ?, ?)`, [
            r.id,
            r.hash,
            r.up,
            r.down,
            evolutionState.applyingUp
          ]),
        startDevolution: (r: Evolution | EvolutionRecord) => applyState(r.id, evolutionState.applyingDown),
        setApplied: (r: Evolution | EvolutionRecord) => applyState(r.id, evolutionState.applied),
        recordError: (id: number, error: string) =>
          sqlRunner.exec(`update ${tableName} set last_problem = ? where id = ?`, [error, id])
      }
    })
  )
