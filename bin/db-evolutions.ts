#!/usr/bin/env node

// biome-ignore-all lint/suspicious/noConsole: CLI entrypoint uses console for user output

import { NodeFileSystem } from "@effect/platform-node"
import { Effect, Layer, pipe } from "effect"
import { createJiti } from "jiti"
import type { ConnectionConfig, MigratorOptionsInput } from "../src/index.ts"
import {
  createDriverFromConfig,
  EvolutionFileParserLive,
  EvolutionFileServiceLive,
  EvolutionRepositoryLive,
  evolutionState,
  FileLineReaderLive,
  fromMigrationDriver,
  MigratorService,
  MigratorServiceLive,
  SqlRunner
} from "../src/index.ts"
import { migratorOptionsValidator } from "../src/types.ts"

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvolutionsConfig {
  connection: ConnectionConfig
  options: MigratorOptionsInput
}

interface CommandLineArguments {
  command: string
  args: string[]
  verbose: boolean
}

// ── Argv Parsing ──────────────────────────────────────────────────────────────

const parseArgs = (): CommandLineArguments => {
  const argv = process.argv.slice(2)
  const verbose = argv.includes("--verbose") || argv.includes("-v")
  const positional = argv.filter(a => a !== "--verbose" && a !== "-v")
  const [command, ...args] = positional

  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: db-evolutions [--verbose|-v] <apply | status | resolve <id>>")
    process.exit(command ? 0 : 1)
  }

  return { command, args, verbose }
}

// ── Config Loading ────────────────────────────────────────────────────────────

const jiti = createJiti(import.meta.url)

const CONFIG_FILENAMES = ["evolutions.config.ts", "evolutions.config.js", "evolutions.config.mjs"] as const

const tryLoadConfig = (name: string): Effect.Effect<EvolutionsConfig, Error> =>
  Effect.tryPromise({
    try: () => jiti.import(`${process.cwd()}/${name}`, { default: true }) as Promise<EvolutionsConfig>,
    catch: () => new Error(`Could not load ${name}`)
  })

const loadConfig = (): Effect.Effect<EvolutionsConfig, Error> =>
  pipe(
    tryLoadConfig(CONFIG_FILENAMES[0]),
    Effect.orElse(() => tryLoadConfig(CONFIG_FILENAMES[1])),
    Effect.orElse(() => tryLoadConfig(CONFIG_FILENAMES[2])),
    Effect.mapError(() => new Error("No evolutions.config.ts found in current directory"))
  )

// ── Layer Construction ────────────────────────────────────────────────────────

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

// ── Commands ──────────────────────────────────────────────────────────────────

interface EvolutionStatusRow {
  id: number
  state: string
  last_problem: string | null
  applied_at: string
}

export interface StatusReport {
  appliedCount: number
  lastEvolution?: { id: number; state: string; appliedAt: string; lastProblem: string | null }
  stuckEvolutions: { id: number; state: string; lastProblem: string | null }[]
}

export const buildStatusReport = (rows: EvolutionStatusRow[]): StatusReport => {
  if (rows.length === 0) return { appliedCount: 0, stuckEvolutions: [] }

  const last = rows[rows.length - 1]
  return {
    appliedCount: rows.length,
    lastEvolution: { id: last.id, state: last.state, appliedAt: last.applied_at, lastProblem: last.last_problem },
    stuckEvolutions: rows
      .filter(r => r.state !== evolutionState.applied)
      .map(r => ({ id: r.id, state: r.state, lastProblem: r.last_problem }))
  }
}

const printStatusReport = (report: StatusReport): void => {
  if (report.appliedCount === 0) {
    console.log("No evolutions applied.")
    return
  }

  console.log(`${report.appliedCount} evolution(s) applied.`)
  if (report.lastEvolution) {
    if (report.lastEvolution.state === evolutionState.applied) {
      console.log(`Last evolution: #${report.lastEvolution.id} — applied successfully at ${new Date(report.lastEvolution.appliedAt).toLocaleString()}`)
    } else {
      console.log(`Last evolution: #${report.lastEvolution.id} — state: ${report.lastEvolution.state}`)
      if (report.lastEvolution.lastProblem) {
        console.log(`Error: ${report.lastEvolution.lastProblem}`)
      }
    }
  }

  if (report.stuckEvolutions.length > 0) {
    console.log(`\n${report.stuckEvolutions.length} stuck evolution(s):`)
    report.stuckEvolutions.forEach(r => {
      console.log(`  #${r.id} — ${r.state}${r.lastProblem ? `: ${r.lastProblem}` : ""}`)
    })
  }
}

const applyCommand = (ServiceLive: ReturnType<typeof buildLayers>) =>
  Effect.provide(
    Effect.flatMap(MigratorService, svc => svc.apply()),
    ServiceLive
  ).pipe(Effect.map(result => console.log(JSON.stringify(result, null, 2))))

const statusCommand = (sqlRunner: SqlRunner["Type"], tableName: string) =>
  sqlRunner.query<EvolutionStatusRow>(
    `SELECT id, state, last_problem, applied_at FROM ${tableName} ORDER BY id`
  ).pipe(
    Effect.map(buildStatusReport),
    Effect.map(printStatusReport)
  )

const resolveCommand = (ServiceLive: ReturnType<typeof buildLayers>, args: string[]) => {
  const id = parseInt(args[0] ?? "", 10)
  if (Number.isNaN(id)) {
    console.error("Usage: db-evolutions resolve <id>")
    process.exit(1)
  }
  return Effect.provide(
    Effect.flatMap(MigratorService, svc => svc.resolve(id)),
    ServiceLive
  ).pipe(Effect.map(result => console.log(JSON.stringify(result, null, 2))))
}

// ── Main ──────────────────────────────────────────────────────────────────────

const main = async (): Promise<void> => {
  const { command, args, verbose } = parseArgs()

  const config = await Effect.runPromise(loadConfig())
  config.options = { ...config.options, verbose }

  const driver = await createDriverFromConfig(config.connection)
  const sqlRunner = fromMigrationDriver(driver)
  const options = migratorOptionsValidator.parse(config.options)
  const ServiceLive = buildLayers(config, sqlRunner)

  const commands: Record<string, Effect.Effect<void, unknown, never>> = {
    apply: applyCommand(ServiceLive),
    status: statusCommand(sqlRunner, options.tableName),
    resolve: resolveCommand(ServiceLive, args)
  }

  try {
    const handler = commands[command]
    if (!handler) {
      console.error(`Unknown command: ${command}`)
      console.error("Usage: db-evolutions <apply | status | resolve <id>>")
      process.exit(1)
    }
    await Effect.runPromise(handler)
  } finally {
    await driver.close()
  }
}

const isDirectExecution = process.argv[1]?.endsWith("db-evolutions.ts") || process.argv[1]?.endsWith("db-evolutions.js")
if (isDirectExecution) {
  main().catch(err => {
    console.error(err)
    process.exit(1)
  })
}
