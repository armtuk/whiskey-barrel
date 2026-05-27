import { Context, Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform"

import { resolveEvolutionFiles } from "./evolution.resolver.ts"
import type { EvolutionFileRef } from "./evolution.resolver.ts"
import type { Evolution, MigratorOptions } from "./types.ts"
import { EvolutionFileParser, type EvolutionParseError } from "./evolution.parser.ts"
import type { PlatformError } from "@effect/platform/Error"
import type { UnknownException } from "effect/Cause"

export class FileLineReader extends Context.Tag("FileLineReader")<FileLineReader, {
  linesFromFile(path: string): Effect.Effect<string[], PlatformError, never>
}>() { }

export const FileLineReaderLive = Layer.effect(
  FileLineReader,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return {
      linesFromFile: (path: string) => fs.readFileString(path).pipe(
        Effect.map(content => content.split("\n"))
      )
    }
  })
)

export class EvolutionFileService extends Context.Tag("EvolutionFileService")<EvolutionFileService, {
  fetchEvolutions(): Effect.Effect<Evolution[], PlatformError | EvolutionParseError | UnknownException>
}>() { }

export const EvolutionFileServiceLive = (options: MigratorOptions) => Layer.effect(
  EvolutionFileService,
  Effect.gen(function* () {
    const parser = yield* EvolutionFileParser
    const lineReader = yield* FileLineReader

    const parseFile = (fileRef: EvolutionFileRef) =>
      lineReader.linesFromFile(fileRef.filePath).pipe(
        Effect.flatMap(lines => parser.parseEvolutionFile(lines)),
        Effect.map(x => ({
          ...x,
          id: fileRef.id
        } as Evolution)
        )
      )

    const fetchEvolutions = () => resolveEvolutionFiles(options.evolutionsRoot, options.dbName, options.dbType)
      .pipe(Effect.flatMap(e => Effect.forEach(e, parseFile)))

    return { fetchEvolutions }
  })
)
