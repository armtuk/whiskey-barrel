import { Context, Effect, Layer, Stream, pipe, Scope } from "effect"
import { FileSystem } from "@effect/platform"

import { resolveEvolutionFiles } from "./evolution.resolver.ts"
import type { EvolutionFileRef } from "./evolution.resolver.ts"
import type { Evolution, MigratorOptions } from "./types.ts"
import { EvolutionFileParser } from "./evolution.parser.ts"
import { PlatformError } from "@effect/platform/Error"

export class FileLineReader extends Context.Tag("FileLineReader")<FileLineReader, {
  lineStreamFromFile(path: string): Effect.Effect<Stream.Stream<string>, PlatformError>,
  linesFromFile(path: string): Effect.Effect<string[], PlatformError, never>
}>() { }

export const FileLineReaderLive = Layer.effect(
  FileLineReader,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return {
      lineStreamFromFile: (path: string) =>
        fs.access(path).pipe(
          Effect.map(() =>
            fs.stream(path).pipe(
              Stream.decodeText(),
              Stream.splitLines,
              Stream.catchAll(() => Stream.empty)
            )
          )
        ),
      linesFromFile: (path: string) => fs.readFileString(path).pipe(
        Effect.map(content => content.split("\n"))
      )
    }
  })
)

export const FileLineReaderSimple = Layer.effect(
  FileLineReader,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return {
      lineStreamFromFile: (path: string) =>
        fs.readFileString(path).pipe(
          Effect.map(content => Stream.fromIterable(content.split("\n")))
        ),
      linesFromFile: (path: string) =>
        fs.readFileString(path).pipe(
          Effect.map(content => content.split("\n"))
        )
    }
  })
)

export class EvolutionFileService extends Context.Tag("EvolutionFileService")<EvolutionFileService, {
  fetchEvolutions(): Effect.Effect<Evolution[], PlatformError>
}>() { }

export const EvolutionFileServiceLive = (options: MigratorOptions) => Layer.effect(
  EvolutionFileService,
  Effect.gen(function* () {
    const parser = yield* EvolutionFileParser
    const lineReader = yield* FileLineReader

    const parseFile = (fileRef: EvolutionFileRef) =>
      lineReader.linesFromFile(fileRef.filePath).pipe(
        Effect.flatMap(lines =>
          parser.parseEvolutionFile(lines)
        )
      )

    const fetchEvolutions = () => resolveEvolutionFiles(options.evolutionsRoot, options.dbName, options.dbType)
      .pipe(Effect.flatMap(e => Effect.forEach(e, parseFile)))

    return { fetchEvolutions }
  })
)
