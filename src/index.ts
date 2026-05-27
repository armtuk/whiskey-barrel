// ── Effect Services ───────────────────────────────────────────────────────────

export { MigratorService, MigratorServiceLive } from "./migrator.service.ts"
export {
  EvolutionFileService,
  EvolutionFileServiceLive,
  FileLineReader,
  FileLineReaderLive,
  FileLineReaderSimple
} from "./evolution-file.service.ts"
export { EvolutionFileParser, EvolutionFileParserLive, EvolutionParseError } from "./evolution.parser.ts"
export { EvolutionRepository, EvolutionRepositoryLive } from "./evolution.repository.ts"
export { SqlRunner, fromBetterSqlite3, fromPostgresJs, toPostgresParams } from "./util/sql-runner.ts"

// ── Types ─────────────────────────────────────────────────────────────────────

export type {
  Evolution,
  EvolutionRecord,
  EvolutionState,
  EvolutionLazy,
  DbType,
  MigratorOptions,
  MigratorOptionsInput,
  ConnectionConfig,
  PostgresqlConnectionConfig,
  SqliteConnectionConfig,
  StatusResult,
  StatusSuccessResult,
  StatusStuckResult,
  StatusFailureResult,
  ApplyResult,
  ApplySuccessResult,
  ApplyFailureResult,
  ApplyNoopResult,
  RollbackResult,
  RollbackSuccessResult,
  RollbackFailureResult,
  ResolveResult,
  ResolveSuccessResult,
  ResolveFailureResult,
  DivergedEvolution
} from "./types.ts"

export {
  defineConfig,
  applyResult,
  resolveResult,
  evolutionValidator,
  evolutionRecordValidator,
  evolutionStateValidator,
  migratorOptionsValidator,
  connectionConfigValidator,
  dbTypes,
  dbType,
  evolutionStates,
  evolutionState,
  InconsistentDatabaseError,
  InitializationError,
  NotFoundError,
  divergedEvolution
} from "./types.ts"

// ── Promise-based Driver Layer ────────────────────────────────────────────────

export { MigrationDriver } from "./drivers/driver.types.ts"
export { createDriverFromConfig } from "./drivers/driver.factory.ts"
