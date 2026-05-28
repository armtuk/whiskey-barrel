#!/usr/bin/env node

// biome-ignore-all lint/suspicious/noConsole: CLI entrypoint uses console for user output

import { config as loadEnv } from "dotenv"
import { NodeFileSystem } from "@effect/platform-node"
import { Cause, Effect, Layer, Option, pipe } from "effect"
import { createJiti } from "jiti"
import type { MigratorOptionsInput } from "../src/index.ts"
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
import { connectionConfigValidator, describeConnectionUrl, extractErrorMessage, migratorOptionsValidator } from "../src/types.ts"

// ── Types ─────────────────────────────────────────────────────────────────────

interface EvolutionsConfig {
  connection: string
  options: MigratorOptionsInput
}

export interface CommandLineArguments {
  command: string
  args: string[]
  quiet: boolean
}

// ── Argv Parsing ──────────────────────────────────────────────────────────────

export const parseArgs = (): CommandLineArguments => {
  const argv = process.argv.slice(2)
  const quiet = argv.includes("--quiet") || argv.includes("-q")
  const positional = argv.filter(a => a !== "--quiet" && a !== "-q")
  const [command, ...args] = positional

  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: db-evolutions [--quiet|-q] <apply | status | resolve <id>>")
    process.exit(command ? 0 : 1)
  }

  return { command, args, quiet }
}

// ── Config Loading ────────────────────────────────────────────────────────────

const jiti = createJiti(import.meta.url)

const CONFIG_FILENAMES = ["evolutions.config.ts", "evolutions.config.js", "evolutions.config.mjs"] as const

const tryLoadConfig = (name: string): Effect.Effect<EvolutionsConfig, Error> =>
  Effect.tryPromise({
    try: () => jiti.import(`${process.cwd()}/${name}`, { default: true }) as Promise<EvolutionsConfig>,
    catch: (err) => new Error(`Failed to load ${name}: ${err instanceof Error ? err.message : String(err)}`)
  })

const loadConfig = (): Effect.Effect<EvolutionsConfig, Error> =>
  pipe(
    tryLoadConfig(CONFIG_FILENAMES[0]),
    Effect.orElse(() => tryLoadConfig(CONFIG_FILENAMES[1])),
    Effect.orElse(() => tryLoadConfig(CONFIG_FILENAMES[2])),
    Effect.mapError(() => new Error(`No evolutions config found in ${process.cwd()}. Searched for: ${CONFIG_FILENAMES.join(", ")}`))
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
  const stuck = rows.filter(r => r.state !== evolutionState.applied)
  return {
    appliedCount: rows.length - stuck.length,
    lastEvolution: { id: last.id, state: last.state, appliedAt: last.applied_at, lastProblem: last.last_problem },
    stuckEvolutions: stuck.map(r => ({ id: r.id, state: r.state, lastProblem: r.last_problem }))
  }
}

const printStatusReport = (report: StatusReport): void => {
  if (report.appliedCount === 0 && report.stuckEvolutions.length === 0) {
    console.log("No evolutions applied.")
    return
  }

  console.log(`${report.appliedCount} evolution(s) applied.`)
  if (report.lastEvolution) {
    if (report.lastEvolution.state === evolutionState.applied) {
      console.log(`Last evolution: #${report.lastEvolution.id} — applied successfully at ${new Date(report.lastEvolution.appliedAt).toLocaleString()}`)
      if (report.lastEvolution.lastProblem) {
        console.log(`  Previous error (now resolved): ${report.lastEvolution.lastProblem}`)
      }
    } else {
      console.log(`Last evolution: #${report.lastEvolution.id} — state: ${report.lastEvolution.state}`)
      if (report.lastEvolution.lastProblem) {
        console.log(`  Error: ${report.lastEvolution.lastProblem}`)
      }
    }
  }

  if (report.stuckEvolutions.length > 0) {
    console.log(`\n${report.stuckEvolutions.length} stuck evolution(s):`)
    report.stuckEvolutions.forEach(r => {
      console.log(`  #${r.id} — ${r.state}`)
      if (r.lastProblem) {
        console.log(`    Error: ${r.lastProblem}`)
      }
      console.log(`    Run 'db-evolutions resolve ${r.id}' after fixing the issue.`)
    })
  }
}

export const applyCommand = (ServiceLive: ReturnType<typeof buildLayers>) =>
  Effect.provide(
    Effect.flatMap(MigratorService, svc => svc.apply()),
    ServiceLive
  ).pipe(Effect.map(result => {
    console.log(JSON.stringify(result, null, 2))
    if (result._tag === "ApplyFailureResult") {
      console.error(`\nError: ${result.error}`)
      if (result.evolutionRecord) {
        console.error(`Evolution #${result.evolutionRecord.id} is stuck in state '${result.evolutionRecord.state}'.`)
        console.error(`Run 'db-evolutions resolve ${result.evolutionRecord.id}' after fixing the issue.`)
      }
      process.exit(1)
    }
  }))

export const statusCommand = (sqlRunner: SqlRunner["Type"], tableName: string) =>
  sqlRunner.query<EvolutionStatusRow>(
    `SELECT id, state, last_problem, applied_at FROM ${tableName} ORDER BY id`
  ).pipe(
    Effect.map(buildStatusReport),
    Effect.map(printStatusReport),
    Effect.catchAll(err => Effect.sync(() => {
      const msg = extractErrorMessage(err)
      if (msg.includes("no such table") || msg.includes("does not exist")) {
        console.log("No evolutions table found. Run 'db-evolutions apply' to initialize.")
      } else {
        console.error(`Error querying status: ${msg}`)
        process.exit(1)
      }
    }))
  )

export const resolveCommand = (ServiceLive: ReturnType<typeof buildLayers>, args: string[]) => {
  const id = parseInt(args[0] ?? "", 10)
  if (Number.isNaN(id)) {
    console.error(`Invalid evolution id: "${args[0] ?? ""}" — expected a numeric id`)
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
  const { command, args, quiet } = parseArgs()

  loadEnv()
  loadEnv({ path: ".env.local", override: true })

  const config = await Effect.runPromise(loadConfig())
  config.options = { ...config.options, quiet }

  let connectionUrl: string
  try {
    connectionUrl = connectionConfigValidator.parse(config.connection)
  } catch (err) {
    console.error("Invalid connection URL in evolutions.config.")
    console.error(`Received: ${JSON.stringify(config.connection)}`)
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const safeUrl = describeConnectionUrl(connectionUrl)
  console.error(`Connecting to ${safeUrl}`)

  const driver = await createDriverFromConfig(connectionUrl)
  const sqlRunner = fromMigrationDriver(driver)

  try {
    await Effect.runPromise(sqlRunner.query("SELECT 1"))
  } catch (err) {
    console.error(`Failed to connect to ${safeUrl}`)
    console.error(err instanceof Error ? err.message : String(err))
    await driver.close()
    process.exit(1)
  }

  const options = migratorOptionsValidator.parse(config.options)
  const ServiceLive = buildLayers(config, sqlRunner)

  const commands: Record<string, () => Effect.Effect<void, unknown, never>> = {
    apply: () => applyCommand(ServiceLive),
    status: () => statusCommand(sqlRunner, options.tableName),
    resolve: () => resolveCommand(ServiceLive, args)
  }

  try {
    const handler = commands[command]
    if (!handler) {
      console.error(`Unknown command: ${command}`)
      console.error("Usage: db-evolutions <apply | status | resolve <id>>")
      process.exit(1)
    }
    await Effect.runPromise(handler())
  } finally {
    await driver.close()
  }
}

const isDirectExecution = process.argv[1]?.endsWith("db-evolutions.ts") || process.argv[1]?.endsWith("db-evolutions.js")
if (isDirectExecution) {
  main().catch(err => {
    const causeSymbol = Object.getOwnPropertySymbols(err).find(s => s.toString().includes("FiberFailure/Cause"))
    if (causeSymbol) {
      const cause = err[causeSymbol]
      const failure = Cause.failureOption(cause)
      if (Option.isSome(failure)) {
        console.error(`Error: ${extractErrorMessage(failure.value)}`)
      } else {
        console.error(Cause.pretty(cause))
      }
    } else if (err instanceof Error) {
      console.error(`Error: ${err.message}`)
    } else {
      console.error("Error:", String(err))
    }
    process.exit(1)
  })
}
