
import { Layer, Effect, Context } from "effect";
import { EvolutionRecord } from "./types.ts";
import { SqlRunner } from "./util/sql-runner.ts";
import { UnknownException } from "effect/Cause";
import type { Option } from "effect"

export class EvolutionRepository extends Context.Tag("EvolutionRepository")<EvolutionRepository, {
  findById(id: number): Effect.Effect<Option.Option<EvolutionRecord>, UnknownException, SqlRunner>
}>() { }

export const EvolutionRepositoryLive = (tableName: string) => Layer.effect(
  EvolutionRepository,
  Effect.gen(function* () {
    const sqlRunner = yield* SqlRunner
    return {
      findById: (id: number) =>
        sqlRunner.query<EvolutionRecord>(`select * from ${tableName} where id = ?`, [id]).pipe(
          Effect.flatMap(rows => rows[0] ? Effect.succeedSome(rows[0]) : Effect.succeedNone)
        )
    }
  })
)
