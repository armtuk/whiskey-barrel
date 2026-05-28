import { createHash } from "node:crypto"
import type { PlatformError } from "@effect/platform/Error"
import { Context, Data, Effect, Layer } from "effect"
import type { Evolution } from "./types.ts"

const UPS_MARKER = "-- #### !Ups"
const DOWNS_MARKER = "-- #### !Downs"

export class EvolutionFileParser extends Context.Tag("EvolutionFileParser")<
  EvolutionFileParser,
  {
    parseEvolutionFile(lines: string[]): Effect.Effect<Partial<Evolution>, EvolutionParseError | PlatformError>
    computeHash(lines: string[]): string
    extractSections(lines: string[]): Effect.Effect<{ up: string; down: string }, EvolutionParseError>
  }
>() {}

export class EvolutionParseError extends Data.TaggedError("EvolutionParseError")<{
  readonly error: unknown
}> {
  override get message(): string {
    return typeof this.error === "string" ? this.error : JSON.stringify(this.error)
  }
}

export const EvolutionFileParserLive = () =>
  Layer.effect(
    EvolutionFileParser,
    Effect.gen(function* () {
      const computeHash = (lines: string[]): string => {
        const hash = createHash("md5")
        lines.forEach(line => hash.update(line.trim()))
        return hash.digest("hex")
      }

      const parseEvolutionFile = (lines: string[]): Effect.Effect<Partial<Evolution>, EvolutionParseError> =>
        Effect.gen(function* () {
          const { up, down } = yield* extractSections(lines)
          return { up, down, hash: computeHash(lines) }
        })

      const extractSections = (lines: string[]): Effect.Effect<{ up: string; down: string }, EvolutionParseError> => {
        const upsMarker = lines.findIndex(x => x.startsWith(UPS_MARKER))
        const downsMarker = lines.findIndex(x => x.startsWith(DOWNS_MARKER))

        if (upsMarker === -1) {
          return Effect.fail(new EvolutionParseError({ error: `Missing "${UPS_MARKER}" marker. Each evolution file must contain an Ups section and a Downs section.` }))
        }
        if (downsMarker === -1) {
          return Effect.fail(new EvolutionParseError({ error: `Missing "${DOWNS_MARKER}" marker. Each evolution file must contain an Ups section and a Downs section.` }))
        }

        return Effect.succeed({ up: lines.slice(upsMarker + 1, downsMarker).join("\n"), down: lines.slice(downsMarker + 1).join("\n") })
      }

      return {
        parseEvolutionFile,
        computeHash,
        extractSections
      }
    })
  )
