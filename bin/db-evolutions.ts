#!/usr/bin/env node

// biome-ignore-all lint/suspicious/noConsole: CLI entrypoint uses console for user output

import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { createJiti } from "jiti"
import type { ConnectionConfig, MigratorOptionsInput } from "../src/index.ts"
import {
  createDriverFromConfig,
  EvolutionFileParserLive,
  EvolutionFileServiceLive,
  EvolutionRepositoryLive,
  FileLineReaderLive,
  fromMigrationDriver,
  MigratorService,
  MigratorServiceLive,
  SqlRunner
} from "../src/index.ts"
import { migratorOptionsValidator } from "../src/types.ts"

interface EvolutionsConfig {
  connection: ConnectionConfig
  options: MigratorOptionsInput
}

const jiti = createJiti(import.meta.url)

const loadConfig = async (): Promise<EvolutionsConfig> => {
  for (const name of ["evolutions.config.ts", "evolutions.config.js", "evolutions.config.mjs"]) {
    try {
      // biome-ignore lint/performance/noAwaitInLoops: sequential fallback through config file candidates
      return (await jiti.import(`${process.cwd()}/${name}`, { default: true })) as EvolutionsConfig
    } catch {}
  }
  throw new Error("No evolutions.config.ts found in current directory")
}

const buildLayers = (config: EvolutionsConfig, sqlRunnerImpl: SqlRunner["Type"]) => {
  const options = migratorOptionsValidator.parse(config.options)
  const SqlRunnerLive = Layer.succeed(SqlRunner, sqlRunnerImpl)
  const RepoLive = EvolutionRepositoryLive(options.tableName).pipe(Layer.provide(SqlRunnerLive))
  const FileServiceLive = EvolutionFileServiceLive(options).pipe(
    Layer.provide(EvolutionFileParserLive()),
    Layer.provide(FileLineReaderLive),
    Layer.provide(NodeFileSystem.layer)
  )
  const DepsLive = Layer.mergeAll(SqlRunnerLive, RepoLive, FileServiceLive)
  return MigratorServiceLive(options).pipe(Layer.provide(DepsLive))
}

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2)
  const verbose = argv.includes("--verbose") || argv.includes("-v")
  const positional = argv.filter(a => a !== "--verbose" && a !== "-v")
  const [command, ...args] = positional

  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: db-evolutions [--verbose|-v] <apply | status | resolve <id>>")
    process.exit(command ? 0 : 1)
  }

  const config = await loadConfig()
  config.options = { ...config.options, verbose }

  const driver = await createDriverFromConfig(config.connection)
  const sqlRunner = fromMigrationDriver(driver)

  const ServiceLive = buildLayers(config, sqlRunner)

  try {
    if (command === "apply") {
      const result = await Effect.runPromise(
        Effect.provide(
          Effect.flatMap(MigratorService, svc => svc.apply()),
          ServiceLive
        )
      )
      console.log(JSON.stringify(result, null, 2))
    } else if (command === "status") {
      console.log("Status command not yet implemented")
      process.exit(1)
    } else if (command === "resolve") {
      const id = parseInt(args[0] ?? "", 10)
      if (Number.isNaN(id)) {
        console.error("Usage: db-evolutions resolve <id>")
        process.exit(1)
      }
      const result = await Effect.runPromise(
        Effect.provide(
          Effect.flatMap(MigratorService, svc => svc.resolve(id)),
          ServiceLive
        )
      )
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.error(`Unknown command: ${command}`)
      console.error("Usage: db-evolutions <apply | status | resolve <id>>")
      process.exit(1)
    }
  } finally {
    await driver.close()
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
