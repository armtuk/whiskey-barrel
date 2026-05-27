// ── Effect Services ───────────────────────────────────────────────────────────

export { EvolutionFileParser, EvolutionFileParserLive, EvolutionParseError } from "./evolution.parser.ts"
export { EvolutionRepository, EvolutionRepositoryLive } from "./evolution.repository.ts"
export {
  EvolutionFileService,
  EvolutionFileServiceLive,
  FileLineReader,
  FileLineReaderLive,
  FileLineReaderSimple
} from "./evolution-file.service.ts"
export { MigratorService, MigratorServiceLive } from "./migrator.service.ts"
export { fromBetterSqlite3, fromPostgresJs, SqlRunner, toPostgresParams } from "./util/sql-runner.ts"

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
  EvolutionLazy,
  EvolutionRecord,
  EvolutionState,
  MigratorOptions,
  MigratorOptionsInput,
  PostgresqlConnectionConfig,
  ResolveFailureResult,
  ResolveResult,
  ResolveSuccessResult,
  RollbackFailureResult,
  RollbackResult,
  RollbackSuccessResult,
  SqliteConnectionConfig,
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
  divergedEvolution,
  evolutionRecordValidator,
  evolutionState,
  evolutionStates,
  evolutionStateValidator,
  evolutionValidator,
  InconsistentDatabaseError,
  InitializationError,
  migratorOptionsValidator,
  NotFoundError,
  resolveResult
} from "./types.ts"

// ── Promise-based Driver Layer ────────────────────────────────────────────────

export { createDriverFromConfig } from "./drivers/driver.factory.ts"
export { MigrationDriver } from "./drivers/driver.types.ts"
