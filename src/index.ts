// ── Effect Services ───────────────────────────────────────────────────────────

export { EvolutionFileParser, EvolutionFileParserLive, EvolutionParseError } from "./evolution.parser.ts"
export { EvolutionRepository, EvolutionRepositoryLive } from "./evolution.repository.ts"
export {
  EvolutionFileService,
  EvolutionFileServiceLive,
  FileLineReader,
  FileLineReaderLive
} from "./evolution-file.service.ts"
export { MigratorService, MigratorServiceLive } from "./migrator.service.ts"
export { fromMigrationDriver, SqlRunner, toPostgresParams } from "./util/sql-runner.ts"

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  ApplyFailureResult,
  ApplyNoopResult,
  ApplyResult,
  ApplySuccessResult,
  ConnectionConfig,
  DbType,
  DivergedEvolution,
  Evolution,
  EvolutionRecord,
  EvolutionState,
  MigratorOptions,
  MigratorOptionsInput,
  ResolveFailureResult,
  ResolveResult,
  ResolveSuccessResult,
  RollbackFailureResult,
  RollbackResult,
  RollbackSuccessResult,
  StatusFailureResult,
  StatusResult,
  StatusStuckResult,
  StatusSuccessResult
} from "./types.ts"

export {
  applyResult,
  connectionConfigValidator,
  dbType,
  dbTypes,
  defineConfig,
  describeConnectionUrl,
  divergedEvolution,
  evolutionRecordValidator,
  evolutionState,
  evolutionStates,
  evolutionStateValidator,
  evolutionValidator,
  extractErrorMessage,
  InconsistentDatabaseError,
  InitializationError,
  MigrationExecError,
  migratorOptionsValidator,
  NotFoundError,
  parseConnectionUrl,
  resolveResult
} from "./types.ts"

// ── Promise-based Driver Layer ────────────────────────────────────────────────

export { createDriverFromConfig, createSqlRunnerFromConfig } from "./drivers/driver.factory.ts"
export type { MigrationDriver } from "./drivers/driver.types.ts"
