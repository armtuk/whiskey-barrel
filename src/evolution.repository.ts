
import { Layer, Effect, Context, Option } from "effect";
import { type Evolution, type EvolutionRecord, evolutionState, type EvolutionState } from "./types.ts";
import { SqlRunner } from "./util/sql-runner.ts";
import type { UnknownException } from "effect/Cause";

export class EvolutionRepository extends Context.Tag("EvolutionRepository")<EvolutionRepository, {
  findById(id: number): Effect.Effect<Option.Option<EvolutionRecord>, UnknownException>
  setApplied(r: Evolution | EvolutionRecord): Effect.Effect<void, UnknownException>,
  startEvolution(r: Evolution): Effect.Effect<void, UnknownException>,
  startDevolution(r: Evolution | EvolutionRecord): Effect.Effect<void, UnknownException>,
}>() { }

export const EvolutionRepositoryLive = (tableName: string) => Layer.effect(
  EvolutionRepository,
  Effect.gen(function* () {
    const sqlRunner = yield* SqlRunner

    const applyState = (hash: string, state: EvolutionState) =>
      sqlRunner.exec(`update ${tableName} set state = ? where hash = ?`, [state, hash])

    return {
      findById: (id: number) =>
        sqlRunner.query<EvolutionRecord>(`select * from ${tableName} where id = ?`, [id]).pipe(
          Effect.map(rows => Option.fromNullable(rows[0]))
        ),
      startEvolution: (r: Evolution) =>
        sqlRunner.exec(`insert into ${tableName} (id, hash, apply_script, revert_script, state) values (?, ?, ?, ?, ?)`, [r.id, r.hash, r.up, r.down, evolutionState.applyingUp]),
      startDevolution: (r: Evolution | EvolutionRecord) => applyState(r.hash, evolutionState.applyingDown),
      setApplied: (r: Evolution | EvolutionRecord) => applyState(r.hash, evolutionState.applied)
    }
  })
)
