#!/usr/bin/env node

// biome-ignore-all lint/suspicious/noConsole: CLI entrypoint uses console for user output

import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer } from "effect"
import { createJiti } from "jiti"
import type { ConnectionConfig, MigratorOptionsInput } from "../src/index.ts"
import {
  EvolutionFileParserLive,
  EvolutionFileServiceLive,
  EvolutionRepositoryLive,
  FileLineReaderLive,
  fromBetterSqlite3,
  fromPostgresJs,
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
  const [, , command, ...args] = process.argv

  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: db-evolutions <apply | status | resolve <id>>")
    process.exit(command ? 0 : 1)
  }

  const config = await loadConfig()

  let sqlRunner: SqlRunner["Type"]
  if (config.connection.type === "sqlite") {
    const { default: Database } = await import("better-sqlite3")
    sqlRunner = fromBetterSqlite3(new Database(config.connection.path))
  } else {
    const { default: postgres } = await import("postgres")
    const sql = config.connection.connectionString
      ? postgres(config.connection.connectionString)
      : postgres({
          host: config.connection.host,
          port: config.connection.port,
          database: config.connection.database,
          username: config.connection.user,
          password: config.connection.password,
          ssl: config.connection.ssl ?? false
        })
    sqlRunner = fromPostgresJs(sql)
  }

  const ServiceLive = buildLayers(config, sqlRunner)

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
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
