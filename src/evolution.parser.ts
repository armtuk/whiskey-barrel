import { createHash } from "node:crypto"

import { Stream, Sink, Effect, Layer, Context, Data } from "effect"
import { Evolution } from "./types.ts"
import { Scope } from "effect/Scope"

const UPS_MARKER = "-- #### !Ups"
const DOWNS_MARKER = "-- #### !Downs"

export class EvolutionFileParser extends Context.Tag("EvolutionFileParser")<EvolutionFileParser, {
  parseEvolutionFile(lines: string[]): Effect.Effect<Evolution>,
  computeHash(lines: string[]): Effect.Effect<string>,
  extractSections(lines: string[]): Effect.Effect<{ up: string, down: string }>,
  splitStatements(sql: string): string[]
}>() { }

export class EvolutionParseError extends Data.TaggedError("EvolutionParseError")<{}> {
  constructor(error: any) {
    super(error)
  }
}

export const EvolutionFileParserLive = () => Layer.effect(
  EvolutionFileParser,
  Effect.gen(function* () {
    const computeHash = (lines: string[]): string => {
      const hash = createHash("md5")
      lines.forEach(line => hash.update(line.trim()))
      return hash.digest("hex")
    }

    const parseEvolutionFile = (lines: string[]): Effect.Effect<Evolution, EvolutionParseError> => Effect.gen(function* () {
      const { up, down } = yield* extractSections(lines)
      return { up, down, hash: computeHash(lines) }
    })


    const extractSections = (lines: string[]): Effect.Effect<{ up: string, down: string }, EvolutionParseError> => {
      const upsMarker = lines.findIndex(x => x.startsWith(UPS_MARKER))
      const downsMarker = lines.findIndex(x => x.startsWith(DOWNS_MARKER))

      if (upsMarker === -1) {
        return Effect.fail(new EvolutionParseError("No Ups marker found in file"))
      }
      if (downsMarker === -1) {
        return Effect.fail(new EvolutionParseError("No Downs marker found in file"))
      }

      return Effect.succeed({ up: lines.slice(upsMarker + 1, downsMarker).join("\n"), down: lines.slice(downsMarker + 1).join("\n") })
    }

    /** Split SQL on `;` boundaries, but treat `;;` as a literal semicolon (not a statement boundary). */
    const splitStatements = (sql: string): string[] =>
      sql
        .split(/(?<!;);(?!;)/)
        .map(s => s.trim())
        .filter(s => s.length > 0)

    return {
      parseEvolutionFile,
      computeHash,
      extractSections,
      splitStatements
    }
  })
)



