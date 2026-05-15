import { Effect } from "effect"
import type { z, ZodError } from "zod"

export const zodParseEffect = <T>(schema: z.ZodType<T>) => (input: unknown): Effect.Effect<T, ZodError> => {
  const result = schema.safeParse(input)
  return result.success ? Effect.succeed(result.data) : Effect.fail(result.error)
}
