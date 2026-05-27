import { FileSystem } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import { Context, Effect, Layer, pipe, Scope, Stream } from "effect"
import type { UnknownException } from "effect/Cause"
import { EvolutionFileParser, type EvolutionParseError } from "./evolution.parser.ts"
import type { EvolutionFileRef } from "./evolution.resolver.ts"
import { resolveEvolutionFiles } from "./evolution.resolver.ts"
import type { Evolution, MigratorOptions } from "./types.ts"

export class FileLineReader extends Context.Tag("FileLineReader")<
  FileLineReader,
  {
    lineStreamFromFile(path: string): Effect.Effect<Stream.Stream<string, PlatformError>, PlatformError>
    linesFromFile(path: string): Effect.Effect<string[], PlatformError, never>
  }
>() {}

export const FileLineReaderLive = Layer.effect(
  FileLineReader,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return {
      lineStreamFromFile: (path: string) =>
        fs.access(path).pipe(Effect.map(() => fs.stream(path).pipe(Stream.decodeText(), Stream.splitLines))),
      linesFromFile: (path: string) => fs.readFileString(path).pipe(Effect.map(content => content.split("\n")))
    }
  })
)

export const FileLineReaderSimple = Layer.effect(
  FileLineReader,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return {
      lineStreamFromFile: (path: string) => fs.readFileString(path).pipe(Effect.map(content => Stream.fromIterable(content.split("\n")))),
      linesFromFile: (path: string) => fs.readFileString(path).pipe(Effect.map(content => content.split("\n")))
    }
  })
)

export class EvolutionFileService extends Context.Tag("EvolutionFileService")<
  EvolutionFileService,
  {
    fetchEvolutions(): Effect.Effect<Evolution[], PlatformError | EvolutionParseError | UnknownException>
  }
>() {}

export const EvolutionFileServiceLive = (options: MigratorOptions) =>
  Layer.effect(
    EvolutionFileService,
    Effect.gen(function* () {
      const parser = yield* EvolutionFileParser
      const lineReader = yield* FileLineReader

      const parseFile = (fileRef: EvolutionFileRef) =>
        lineReader.linesFromFile(fileRef.filePath).pipe(
          Effect.flatMap(lines => parser.parseEvolutionFile(lines)),
          Effect.map(
            x =>
              ({
                ...x,
                id: fileRef.id
              }) as Evolution
          )
        )

      const fetchEvolutions = () =>
        resolveEvolutionFiles(options.evolutionsRoot, options.dbName, options.dbType).pipe(
          Effect.flatMap(e => Effect.forEach(e, parseFile))
        )

      return { fetchEvolutions }
    })
  )
