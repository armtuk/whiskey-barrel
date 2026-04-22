# Feature: `db-evolutions` — TypeScript Database Migration Library

The following plan should be complete, but it's important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming conventions (`.service.ts`, `.repository.ts`, `.spec.ts`), Zod validators for all model types, and the Gather/Compute/Persist separation in the core algorithm. Import from the right files.

---

## Feature Description

A TypeScript library that brings Play Framework's "evolutions" pattern to Node.js. Migration files are numbered incrementally (`1.sql`, `2.sql`, …), each with a `-- ###!Ups` section and a `-- ###!Downs` section. The library applies them in order, tracks state in a `db_evolutions` database table, and when a file's MD5 hash changes it rolls back from the highest applied migration down to the changed one then reapplies forward. A pluggable `MigrationDriver` interface enables any SQL-capable database. Ships with adapters for PostgreSQL (`pg`) and SQLite (`better-sqlite3`, `node:sqlite`) plus a CLI binary.

---

## User Story

As a TypeScript backend developer
I want a simple, file-based database migration library that auto-detects and re-applies changed migrations
So that my schema is always consistent with my checked-in SQL files without complex tooling or a separate migration runner

---

## Problem Statement

Existing Node.js migration tools are either tightly coupled to an ORM (knex, drizzle, typeorm), opinionated about file format, or require configuration boilerplate. The Play Framework evolutions model — plain numbered SQL files with Up/Down sections, MD5-based change detection — is simple and battle-tested. No equivalent exists in the TypeScript ecosystem.

---

## Solution Statement

Build a zero-dependency-core TypeScript library with a two-method driver interface, Play-compatible file format (with `###` markers), state-tracked migrations table, and MD5 change detection + auto rollback/reapply. Distribute dual ESM/CJS with optional peer deps for each supported driver.

---

## Feature Metadata

**Feature Type**: New Capability  
**Estimated Complexity**: High  
**Primary Systems Affected**: New project — all files are new  
**Dependencies**: `zod`, `jiti` (runtime); `tsup`, `vitest`, `pnpm` (dev); `pg`, `better-sqlite3` (optional peer deps)

---

## CONTEXT REFERENCES

### Architectural Constraints — READ `.agents/general.md`, `.agents/languages/typescript/*.md`, `.agents/formatting.md`, `.agents/object-types.md` BEFORE WRITING ANY CODE

- **Separation of Concerns / Gather-Compute-Persist**: The `MigratorService.apply()` method must strictly separate: (1) GATHER — read all evolution files from disk AND all `db_evolutions` rows from DB; (2) COMPUTE — diff them in pure logic with no IO to produce an ordered operation list; (3) PERSIST — execute the operation list. Once in the Compute phase, no additional IO is permitted.
- **Direct Driver Access (no repository layer)**: `MigratorService` calls `driver.query()` and `driver.exec()` directly for all `db_evolutions` bookkeeping. The SQL is simple enough that a separate repository would be unnecessary indirection.
- **Dog-fooded table initialization**: The `db_evolutions` `CREATE TABLE IF NOT EXISTS` DDL runs through `driver.exec()` — the same execution path user migrations take — validating the driver works with the user's settings before any migrations run.
- **CQRS**: `status()` is a query (read-only). `apply()`, `rollback()`, `resolve()` are commands (mutating). They must not be mixed.
- **Service Objects**: `MigratorService` and `EvolutionFileService` are service objects, instantiated by the caller (or DI). They are named `*.service.ts`.
- **Utility Objects**: `EvolutionParser` (parse SQL + hash) and `EvolutionResolver` (path resolution) are utility objects — pure functions, no IO side effects.
- **Return Types**: All service methods use `XYZSuccessResult | XYZFailureResult` union types with `status: "success" | "failure"` discriminant. All methods must have explicit return type declarations.
- **Zod validators**: Every model type must be declared via `z.object(...).strict()` + `z.infer<>`.
- **No trailing semicolons** in TypeScript files.
- **No extraneous comments** — code tells the story.
- **async keyword** explicit on all async functions.
- **pnpm** for package management; **vitest** for testing.
- **Test files**: `{source}.spec.ts` colocated with source. Use `describe` + `it` blocks. Prefer real code paths and fixtures over mocks.
- **140-char line limit**. Most abstract at top of each file, helpers at bottom.
- **Exceptions for unexpected failures only** (e.g., `InconsistentDatabaseError`). Expected failures (conflicts when `autoApply=false`) use algebraic return types.

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

This is a brand-new project. No existing source to reference. Read these `.agents` files before writing any code:

- `.agents/general.md` — core architectural principles (always load)
- `.agents/languages/typescript/typescript.md` — TypeScript coding rules (alwaysApply)
- `.agents/languages/typescript/typescript-testing.md` — testing standards (alwaysApply)
- `.agents/languages/typescript/typescript-tools.md` — pnpm + vitest preference
- `.agents/formatting.md` — 140-char limit, information order, decomposition rules (alwaysApply)
- `.agents/object-types.md` — 5 object types, naming conventions (alwaysApply)
- `.agents/guidance/now.md` — NOW.md session logging (alwaysApply, glob: *)

### New Files to Create

```
package.json                                    - Library manifest, pnpm, dual ESM/CJS exports
tsconfig.json                                   - TypeScript config (NodeNext modules, strict)
tsup.config.ts                                  - Build config (ESM + CJS + .d.ts)
vitest.config.ts                                - Test config
src/
  types.ts                                      - All Zod validators, inferred types, error classes
  evolution.parser.ts                           - Utility: parse SQL file → {up, down}, compute MD5
  evolution.parser.spec.ts                      - Unit tests for parser
  evolution.resolver.ts                         - Utility: resolve evolutions directory path
  evolution.resolver.spec.ts                    - Unit tests for resolver
  migrator.service.ts                           - Service: apply/rollback/resolve/status + db_evolutions SQL
  migrator.service.spec.ts                      - Integration tests with real SQLite
  index.ts                                      - Public API barrel
  drivers/
    driver.types.ts                             - MigrationDriver interface
    better-sqlite3.driver.ts                    - Adapter: better-sqlite3
    better-sqlite3.driver.spec.ts               - Tests
    node-sqlite.driver.ts                       - Adapter: node:sqlite (Node.js >= 22.13)
    pg.driver.ts                                - Adapter: pg Pool
    postgres-js.driver.ts                       - Adapter: postgres.js
  sql/
    init.sqlite.sql                             - SQLite CREATE TABLE IF NOT EXISTS for db_evolutions
    init.postgresql.sql                         - PostgreSQL CREATE TABLE IF NOT EXISTS for db_evolutions
bin/
  db-evolutions.ts                              - CLI: apply / status / resolve commands
NOW.md                                          - Session log (required by .agents/guidance/now.md)
```

### Relevant Documentation — READ BEFORE IMPLEMENTING ADAPTERS

- [node-postgres Pool API](https://node-postgres.com/apis/pool) — `pool.query(sql, params)` returns `{ rows: T[] }`
- [better-sqlite3 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — `db.exec(sql)` (multi-statement, sync), `db.prepare(sql).all(...params)` (sync)
- [Node.js SQLite docs](https://nodejs.org/api/sqlite.html) — `db.exec(sql)` returns void (not `this`), Node.js >= 22.13
- [porsager/postgres `sql.unsafe()`](https://github.com/porsager/postgres#unsafe) — for raw SQL string execution
- [tsup config](https://tsup.egoist.dev/#usage) — multiple entry points, `dts: true`, `format: ['cjs', 'esm']`
- [peerDependenciesMeta](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#peerdependenciesmeta) — mark peer deps optional

---

## Patterns to Follow

**Naming Conventions:**
- Service files: `{domain}.service.ts` (e.g., `migrator.service.ts`)
- Repository files: `{domain}.repository.ts` (e.g., `evolution.repository.ts`)
- Utility files: `{domain}.{role}.ts` (e.g., `evolution.parser.ts`, `evolution.resolver.ts`)
- Driver files: `{driver}.driver.ts`
- Test files: `{source}.spec.ts` colocated with source
- DB table/column names: ANSI `snake_case`

**Zod Validator Pattern:**
```typescript
import { z } from "zod"

export const evolutionRecordValidator = z.object({
  id: z.number().int().positive(),
  hash: z.string(),
  applied_at: z.date(),
  apply_script: z.string(),
  revert_script: z.string(),
  state: z.enum(['applying_up', 'applied', 'applying_down']),
  last_problem: z.string().nullable(),
}).strict()

export type EvolutionRecord = z.infer<typeof evolutionRecordValidator>
```

**Result Union Pattern:**
```typescript
interface ApplySuccessResult {
  status: "success"
  applied: number[]
  rolledBack: number[]
}
interface ApplyConflictResult {
  status: "conflict"
  changedAt: number
  details: string
}
interface ApplyFailureResult {
  status: "failure"
  error: string
  stuckAt?: number
}
type ApplyResult = ApplySuccessResult | ApplyConflictResult | ApplyFailureResult
```

**Gather/Compute/Persist in a Service Method:**
```typescript
async apply(options: ApplyOptions): Promise<ApplyResult> {
  // GATHER
  await this.initialize()  // CREATE TABLE IF NOT EXISTS via driver.exec()
  const [files, records] = await Promise.all([
    this.fileService.fetchEvolutions(),
    this.fetchAllRecords(),  // driver.query() directly
  ])
  // COMPUTE (pure — no IO from here)
  const plan = computeMigrationPlan(files, records, options)
  if (plan.status !== "ready") return plan
  // PERSIST
  return this.executePlan(plan)
}
```

**Dog-fooded table initialization:**
```typescript
private async initialize(): Promise<void> {
  // Load the appropriate init SQL for the db type and run it through driver.exec()
  // — the same path user migrations take, validating the driver works
  const initSql = getInitSql(this.options.dbType, this.options.tableName)
  await this.driver.exec(initSql)
}
```

**Exception for unexpected state:**
```typescript
export class InconsistentDatabaseError extends Error {
  constructor(public readonly stuckRecords: EvolutionRecord[]) {
    super(`Database has ${stuckRecords.length} stuck evolution(s). Call resolve(id) to fix.`)
    this.name = 'InconsistentDatabaseError'
  }
}
```

---

## IMPLEMENTATION PLAN

### Phase 1: Project Scaffold

Set up the project tooling, config files, and empty package.json with correct dual ESM/CJS exports, optional peer deps, and bin entry.

### Phase 2: Types & Domain Model

Define all Zod validators and inferred TypeScript types. This is the single source of truth for every data shape in the library. Also define error classes here.

### Phase 3: Core Utilities (pure, no IO)

Implement `EvolutionParser` (parse SQL file content, compute MD5) and `EvolutionResolver` (file discovery). These are pure utility functions with unit tests — no database, no filesystem side effects except reading.

### Phase 4: Service Layer

Implement `MigratorService` — the orchestrator. `apply()` strictly follows Gather/Compute/Persist. `status()` is read-only. `rollback()` and `resolve()` are write-only commands. All `db_evolutions` SQL lives directly in the service — no separate repository. Table initialization is dog-fooded through `driver.exec()` using db-type-specific init SQL scripts (e.g., `src/sql/init.sqlite.sql`, `src/sql/init.postgresql.sql`).

### Phase 5: Driver Adapters

Implement the four built-in adapters as thin wrappers satisfying `MigrationDriver`. Each is 5–10 lines plus a spec.

### Phase 6: Public API & CLI

Export the public surface from `src/index.ts`. Wire up the `bin/db-evolutions.ts` CLI with `apply`, `status`, and `resolve` commands loading config from `evolutions.config.ts` via `jiti`.

---

## STEP-BY-STEP TASKS

### Task 0: UPDATE `NOW.md`
- **ADD**: Session start entry per `.agents/guidance/now.md` — timestamp, prompt summary, project context
- **VALIDATE**: `cat NOW.md` shows current session entry

---

### Task 1: CREATE `package.json`
- **IMPLEMENT**: Library manifest with pnpm workspace, dual ESM/CJS exports, optional peer deps for `pg`, `postgres`, `better-sqlite3`, bin entry for CLI
- **CONTENT**:
```json
{
  "name": "db-evolutions",
  "version": "0.1.0",
  "description": "Play Framework-style database evolutions for Node.js",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
      "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
    },
    "./drivers/pg": {
      "import": { "types": "./dist/drivers/pg.driver.d.ts", "default": "./dist/drivers/pg.driver.js" },
      "require": { "types": "./dist/drivers/pg.driver.d.cts", "default": "./dist/drivers/pg.driver.cjs" }
    },
    "./drivers/postgres-js": {
      "import": { "types": "./dist/drivers/postgres-js.driver.d.ts", "default": "./dist/drivers/postgres-js.driver.js" },
      "require": { "types": "./dist/drivers/postgres-js.driver.d.cts", "default": "./dist/drivers/postgres-js.driver.cjs" }
    },
    "./drivers/better-sqlite3": {
      "import": { "types": "./dist/drivers/better-sqlite3.driver.d.ts", "default": "./dist/drivers/better-sqlite3.driver.js" },
      "require": { "types": "./dist/drivers/better-sqlite3.driver.d.cts", "default": "./dist/drivers/better-sqlite3.driver.cjs" }
    },
    "./drivers/node-sqlite": {
      "import": { "types": "./dist/drivers/node-sqlite.driver.d.ts", "default": "./dist/drivers/node-sqlite.driver.js" },
      "require": { "types": "./dist/drivers/node-sqlite.driver.d.cts", "default": "./dist/drivers/node-sqlite.driver.cjs" }
    }
  },
  "bin": { "db-evolutions": "./dist/bin/db-evolutions.js" },
  "files": ["dist", "README.md"],
  "engines": { "node": ">=18" },
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "pnpm typecheck && pnpm build"
  },
  "dependencies": { "zod": "^3.23.0", "jiti": "^2.0.0" },
  "peerDependencies": { "pg": ">=8.0.0", "postgres": ">=3.0.0", "better-sqlite3": ">=9.0.0" },
  "peerDependenciesMeta": {
    "pg": { "optional": true },
    "postgres": { "optional": true },
    "better-sqlite3": { "optional": true }
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsup": "^8.0.0",
    "vitest": "^2.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "pg": "^8.0.0",
    "@types/pg": "^8.0.0",
    "better-sqlite3": "^9.0.0",
    "@types/better-sqlite3": "^7.0.0",
    "@types/node": "^22.0.0"
  }
}
```
- **VALIDATE**: `cat package.json | pnpm exec node -e "const p=require('./package.json');console.log(p.name)"`

---

### Task 2: CREATE `tsconfig.json`
- **IMPLEMENT**: NodeNext module resolution, strict mode, `src/` rootDir
- **CONTENT**:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "bin"],
  "exclude": ["node_modules", "dist"]
}
```
- **VALIDATE**: `pnpm tsc --noEmit` (after src files exist)

---

### Task 3: CREATE `tsup.config.ts`
- **IMPLEMENT**: Multiple entry points covering all public surfaces + bin
- **CONTENT**:
```typescript
import { defineConfig } from "tsup"

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/drivers/pg.driver.ts",
    "src/drivers/postgres-js.driver.ts",
    "src/drivers/better-sqlite3.driver.ts",
    "src/drivers/node-sqlite.driver.ts",
    "bin/db-evolutions.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
})
```
- **VALIDATE**: `pnpm build` after all source files exist

---

### Task 4: CREATE `vitest.config.ts`
- **IMPLEMENT**: Node environment, coverage via v8
- **CONTENT**:
```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
  },
})
```
- **VALIDATE**: `pnpm test` (after spec files exist)

---

### Task 5: INSTALL dependencies
- **RUN**: `pnpm install`
- **GOTCHA**: `better-sqlite3` requires a native build step — ensure build tools present
- **VALIDATE**: `ls node_modules/zod node_modules/vitest node_modules/better-sqlite3`

---

### Task 6: CREATE `src/drivers/driver.types.ts`
- **IMPLEMENT**: The two-method `MigrationDriver` interface — the only coupling point between the library and any database
- **CONTENT**:
```typescript
export interface MigrationDriver {
  /** Execute raw SQL — may contain multiple statements. No parameterization. Used for migration files. */
  exec(sql: string): Promise<void>
  /** Execute a parameterized query. Returns typed rows. Used for db_evolutions ledger operations. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}
```
- **VALIDATE**: `pnpm typecheck`

---

### Task 7: CREATE `src/types.ts`
- **IMPLEMENT**: All Zod validators, inferred types, result union types, error classes, and `MigratorOptions`
- **IMPORTS**: `import { z } from "zod"` — no other imports
- **PATTERN**: Zod `.strict()` + `z.infer<>` per `.agents/languages/typescript/typescript.md`
- **PATTERN**: `XYZSuccessResult | XYZFailureResult` per `.agents/languages/typescript/typescript.md`
- **CONTENT OUTLINE**:

```typescript
import { z } from "zod"

// ── Domain Models ──────────────────────────────────────────────────────────────

export const evolutionStateValidator = z.enum(['applying_up', 'applied', 'applying_down'])
export type EvolutionState = z.infer<typeof evolutionStateValidator>

export const evolutionValidator = z.object({
  id: z.number().int().positive(),
  up: z.string(),
  down: z.string(),
  hash: z.string(),    // MD5 of (down.trim() + up.trim())
}).strict()
export type Evolution = z.infer<typeof evolutionValidator>

export const evolutionRecordValidator = z.object({
  id: z.number().int().positive(),
  hash: z.string(),
  applied_at: z.date(),
  apply_script: z.string(),
  revert_script: z.string(),
  state: evolutionStateValidator,
  last_problem: z.string().nullable(),
}).strict()
export type EvolutionRecord = z.infer<typeof evolutionRecordValidator>

// ── Configuration ──────────────────────────────────────────────────────────────

export const migratorOptionsValidator = z.object({
  dbName: z.string(),
  dbType: z.string().optional(),
  evolutionsRoot: z.string().default('conf/evolutions'),
  tableName: z.string().default('db_evolutions'),
  autoApply: z.boolean().default(false),
}).strict()
export type MigratorOptions = z.infer<typeof migratorOptionsValidator>

export const defineConfig = (config: MigratorOptions): MigratorOptions => config

// ── Result Types ───────────────────────────────────────────────────────────────

export interface StatusSuccessResult {
  status: "success"
  applied: EvolutionRecord[]
  pending: Evolution[]
  conflicts: Array<{ id: number; fileHash: string; dbHash: string }>
  stuck: EvolutionRecord[]
}
export interface StatusFailureResult { status: "failure"; error: string }
export type StatusResult = StatusSuccessResult | StatusFailureResult

export interface ApplySuccessResult { status: "success"; applied: number[]; rolledBack: number[] }
export interface ApplyConflictResult { status: "conflict"; changedAt: number; details: string }
export interface ApplyFailureResult { status: "failure"; error: string; stuckAt?: number }
export type ApplyResult = ApplySuccessResult | ApplyConflictResult | ApplyFailureResult

export interface ResolveSuccessResult { status: "success"; id: number }
export interface ResolveFailureResult { status: "failure"; error: string }
export type ResolveResult = ResolveSuccessResult | ResolveFailureResult

// ── Errors (unexpected failures only) ─────────────────────────────────────────

export class InconsistentDatabaseError extends Error {
  constructor(public readonly stuckRecords: EvolutionRecord[]) {
    super(`${stuckRecords.length} stuck evolution(s) found. Call resolve(id) to fix.`)
    this.name = 'InconsistentDatabaseError'
  }
}
```
- **VALIDATE**: `pnpm typecheck`

---

### Task 8: CREATE `src/evolution.parser.ts`
- **IMPLEMENT**: Utility functions — parse SQL file content into `{ up, down }` sections; compute MD5 hash. Pure functions, no IO.
- **SECTION MARKER REGEX**: `^(--|#).*###!Ups` and `^(--|#).*###!Downs` (case-sensitive, multiline)
- **HASH**: MD5 of `(down.trim() + up.trim())` — down first, matches Play convention
- **USE**: Node.js built-in `crypto.createHash('md5')` — no external dep needed
- **STATEMENT SPLITTING**: Split on `;` but not `;;` — regex `(?<!;);(?!;)`. Then trim and filter empty.
- **GOTCHA**: Multiple `###!Ups` or `###!Downs` markers in one file should concatenate — per Play spec
- **CONTENT OUTLINE**:
```typescript
import { createHash } from "crypto"
import type { Evolution } from "./types.js"

// Parse SQL file content (id derived from filename — caller's responsibility)
export const parseEvolutionFile = (id: number, content: string): Evolution => {
  const { up, down } = extractSections(content)
  return { id, up, down, hash: computeHash(up, down) }
}

export const computeHash = (up: string, down: string): string =>
  createHash('md5').update(down.trim() + up.trim()).digest('hex')

// ... extractSections, splitStatements helpers below
```
- **VALIDATE**: `pnpm test src/evolution.parser.spec.ts`

---

### Task 9: CREATE `src/evolution.parser.spec.ts`
- **IMPLEMENT**: Vitest unit tests — colocated with parser
- **TEST CASES**:
  - Parses a standard file with `-- ###!Ups` and `-- ###!Downs` markers
  - Handles `# ###!Ups` (hash-comment style markers)
  - Multiple `###!Ups` sections concatenate correctly
  - `;;` is not treated as a statement boundary
  - Hash is MD5 of `down.trim() + up.trim()`
  - Empty up or empty down sections produce empty strings (not undefined)
  - File with no markers produces empty up and down
- **PATTERN**: `describe` + `it` blocks per `.agents/languages/typescript/typescript-testing.md`
- **VALIDATE**: `pnpm test src/evolution.parser.spec.ts`

---

### Task 10: CREATE `src/evolution.resolver.ts`
- **IMPLEMENT**: Utility that discovers and sorts `.sql` files given `dbName`, optional `dbType`, and `evolutionsRoot`. Pure function except for `fs` reads.
- **RESOLUTION LOGIC**:
  1. If `dbType` provided: try `{evolutionsRoot}/{dbName}.{dbType}/` first
  2. Fall back to `{evolutionsRoot}/{dbName}/`
  3. Read directory for `*.sql` files, parse filename as integer, sort ascending
  4. Return sorted array of `{ id: number, filePath: string }`
- **IMPORTS**: `import { readdirSync, existsSync } from "fs"` (sync is fine — called at startup)
- **GOTCHA**: Files named `01.sql`, `001.sql` etc. must sort the same as `1.sql` — parse to integer, not string sort
- **VALIDATE**: `pnpm test src/evolution.resolver.spec.ts`

---

### Task 11: CREATE `src/evolution.resolver.spec.ts`
- **IMPLEMENT**: Unit tests using temporary directories (`os.tmpdir()` + unique subfolder, clean up in `afterEach`)
- **TEST CASES**:
  - Finds type-specific directory when `dbType` matches and falls back to generic
  - Returns files sorted numerically (1, 2, 10 — not 1, 10, 2)
  - Returns empty array when directory does not exist
  - Handles `01.sql` and `001.sql` filename variants (parse as int)
- **VALIDATE**: `pnpm test src/evolution.resolver.spec.ts`

---

### Task 12: CREATE `src/evolution.file.service.ts`
- **IMPLEMENT**: `EvolutionFileService` — service that uses `EvolutionResolver` + `EvolutionParser` to return all `Evolution` objects for a given database. Performs the filesystem IO gather phase.
- **CONTENT OUTLINE**:
```typescript
import { readFileSync } from "fs"
import { parseEvolutionFile } from "./evolution.parser.js"
import { resolveEvolutionFiles } from "./evolution.resolver.js"
import type { Evolution, MigratorOptions } from "./types.js"

export class EvolutionFileService {
  constructor(private readonly options: MigratorOptions) {}

  fetchEvolutions(): Evolution[] {
    const files = resolveEvolutionFiles(
      this.options.evolutionsRoot,
      this.options.dbName,
      this.options.dbType,
    )
    return files.map(({ id, filePath }) => parseEvolutionFile(id, readFileSync(filePath, 'utf-8')))
  }
}
```
- **NOTE**: This is in the GATHER phase. Returns synchronously because file reading is fine sync at startup.
- **VALIDATE**: `pnpm typecheck`

---

### Task 13: CREATE `src/sql/init.sqlite.sql` and `src/sql/init.postgresql.sql`
- **IMPLEMENT**: Database-type-specific DDL scripts for creating the `db_evolutions` table. Each script uses syntax appropriate for its database (e.g., `INTEGER` vs `SERIAL`, `TIMESTAMP` handling).
- **CONTENT** (`init.sqlite.sql`):
```sql
CREATE TABLE IF NOT EXISTS db_evolutions (
  id             INTEGER      NOT NULL PRIMARY KEY,
  hash           VARCHAR(64)  NOT NULL,
  applied_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  apply_script   TEXT,
  revert_script  TEXT,
  state          VARCHAR(32)  NOT NULL,
  last_problem   TEXT
);
```
- **CONTENT** (`init.postgresql.sql`):
```sql
CREATE TABLE IF NOT EXISTS db_evolutions (
  id             INTEGER      NOT NULL PRIMARY KEY,
  hash           VARCHAR(64)  NOT NULL,
  applied_at     TIMESTAMP    NOT NULL DEFAULT NOW(),
  apply_script   TEXT,
  revert_script  TEXT,
  state          VARCHAR(32)  NOT NULL,
  last_problem   TEXT
);
```
- **NOTE**: These scripts are loaded at runtime and executed through `driver.exec()` — the same path user migrations take. The table name placeholder `db_evolutions` is replaced with `options.tableName` at runtime (after validating it matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/`).
- **VALIDATE**: `pnpm typecheck`

---

### Task 14: CREATE `src/migrator.service.ts`
- **IMPLEMENT**: `MigratorService` — the main orchestrator. Strictly Gather/Compute/Persist separated. All `db_evolutions` SQL lives directly in this service — no separate repository.
- **CONSTRUCTOR**: `(driver: MigrationDriver, options: MigratorOptions)`
- **INTERNAL DEPS**: Creates `EvolutionFileService` internally
- **TABLE INITIALIZATION**: Private `initialize()` method loads the appropriate init SQL script for the configured `dbType` (defaulting to `sqlite`), replaces `db_evolutions` with `options.tableName`, and runs it through `driver.exec()` — dog-fooding the same execution path user migrations take.
- **KEY ALGORITHM** in `apply()`:
```
GATHER:
  await this.initialize()                           // CREATE TABLE IF NOT EXISTS via driver.exec()
  files    = fileService.fetchEvolutions()          // disk IO
  records  = await driver.query(...)                // DB IO — direct, no repository

COMPUTE (pure — no IO):
  stuck    = findStuck(records)                     // state IN ('applying_up', 'applying_down')
  if stuck → throw InconsistentDatabaseError(stuck)
  changeIdx = findFirstDivergence(files, records)   // compare hashes
  if changeIdx found AND !autoApply → return { status: "conflict", changedAt: changeIdx.id, ... }
  plan = buildOperationPlan(files, records, changeIdx)  // ordered list of downs then ups

PERSIST:
  for each down in plan.downs (reverse order, high to low):
    await driver.query(UPDATE ... SET state='applying_down')
    await driver.exec(down.revert_script)
    await driver.query(DELETE ...)
  for each up in plan.ups (forward order, low to high):
    await driver.query(INSERT ... state='applying_up')
    await driver.exec(up.apply_script)
    await driver.query(UPDATE ... SET state='applied')
```
- **`status()`**: GATHER only — no mutations. Returns `StatusResult` with applied/pending/conflicts/stuck.
- **`resolve(id)`**: Marks a stuck migration as resolved (applying_up → applied, applying_down → delete)
- **GOTCHA**: `findFirstDivergence` must handle the case where `files.length > records.length` (new files only, no conflict — just apply forward). A conflict requires a HASH MISMATCH at an existing record, not just new files.
- **VALIDATE**: `pnpm test src/migrator.service.spec.ts`

---

### Task 15: CREATE `src/migrator.service.spec.ts`
- **IMPLEMENT**: Integration tests with real `better-sqlite3` in-memory DB + temp filesystem dir
- **FIXTURE HELPER**: `createTestEnv()` — creates temp evolution dir, in-memory SQLite driver, `MigratorService`; cleanup in `afterEach`
- **TEST CASES**:
  1. **Happy path**: Apply 3 migrations → all 3 rows in `db_evolutions` with state=applied
  2. **Hash change detected, autoApply=false**: Returns `{ status: "conflict" }` without modifying DB
  3. **Hash change + autoApply=true**: Rolls back 4→3→2, reapplies new 2→3→4
  4. **Stuck migration on startup**: `apply()` throws `InconsistentDatabaseError` when any row is stuck
  5. **resolve() fixes applying_up**: Row moves to applied
  6. **resolve() fixes applying_down**: Row is deleted
  7. **status() is read-only**: Calling it never mutates `db_evolutions`
  8. **New files only (no conflict)**: Files added beyond existing records are applied without rollback
  9. **Custom tableName option**: `db_evolutions` table renamed via `tableName` option
  10. **Type-specific directory**: `dbType='sqlite'` resolves type-specific folder first
- **VALIDATE**: `pnpm test src/migrator.service.spec.ts`

---

### Task 16: CREATE `src/drivers/better-sqlite3.driver.ts`
- **IMPLEMENT**: Thin adapter wrapping `better-sqlite3` `Database`
- **IMPORTS**: `import type Database from "better-sqlite3"` (type-only — no runtime dep)
- **CONTENT**:
```typescript
import type Database from "better-sqlite3"
import type { MigrationDriver } from "./driver.types.js"

export const fromBetterSqlite3 = (db: Database.Database): MigrationDriver => ({
  exec: async (sql: string): Promise<void> => { db.exec(sql) },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.prepare(sql).all(...params) as T[],
})
```
- **GOTCHA**: `db.exec()` returns `this` (not `void`). Wrapper explicitly returns nothing.
- **GOTCHA**: `db.prepare(sql).all(...params)` — spread params, do not pass array directly.
- **VALIDATE**: `pnpm typecheck`

---

### Task 17: CREATE `src/drivers/better-sqlite3.driver.spec.ts`
- **IMPLEMENT**: Tests that the adapter correctly implements `MigrationDriver`
- **TEST CASES**:
  - `exec()` runs multi-statement DDL (CREATE TABLE + INSERT in one string)
  - `query()` returns typed rows with parameters
  - `query()` with no params works correctly
- **VALIDATE**: `pnpm test src/drivers/better-sqlite3.driver.spec.ts`

---

### Task 18: CREATE `src/drivers/node-sqlite.driver.ts`
- **IMPLEMENT**: Adapter for Node.js built-in `node:sqlite` (Node >= 22.13)
- **CONTENT**:
```typescript
import type { DatabaseSync } from "node:sqlite"
import type { MigrationDriver } from "./driver.types.js"

export const fromNodeSqlite = (db: DatabaseSync): MigrationDriver => ({
  exec: async (sql: string): Promise<void> => { db.exec(sql) },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    db.prepare(sql).all(...params) as T[],
})
```
- **GOTCHA**: `node:sqlite` `db.exec()` returns `void` (unlike better-sqlite3 which returns `this`). Still safe to call.
- **GOTCHA**: This adapter is only valid on Node.js >= 22.13. Export a runtime guard or document the requirement in JSDoc.
- **VALIDATE**: `pnpm typecheck`

---

### Task 19: CREATE `src/drivers/pg.driver.ts`
- **IMPLEMENT**: Adapter for `pg` Pool (or Client)
- **IMPORTS**: `import type { Pool } from "pg"` (type-only)
- **CONTENT**:
```typescript
import type { Pool } from "pg"
import type { MigrationDriver } from "./driver.types.js"

export const fromPgPool = (pool: Pool): MigrationDriver => ({
  exec: async (sql: string): Promise<void> => { await pool.query(sql) },
  query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> =>
    pool.query<T>(sql, params).then(r => r.rows),
})
```
- **GOTCHA**: `pg.Pool.query()` does NOT support multi-statement SQL for security reasons (prevents `; DROP TABLE` injection). Multi-statement DDL in evolution files must go through a single-connection client using `pool.connect()`, then `client.query()`. Alternatively, split statements before executing. Recommend: for `exec()`, check if sql contains multiple statements and handle via `pool.connect()` → single client → multiple `client.query()` calls → `client.release()`.
- **CONTENT (updated exec)**:
```typescript
exec: async (sql: string): Promise<void> => {
  const client = await pool.connect()
  try {
    const statements = splitStatements(sql)
    for (const stmt of statements) await client.query(stmt)
  } finally {
    client.release()
  }
},
```
- **IMPORT**: `splitStatements` from `../evolution.parser.js`
- **VALIDATE**: `pnpm typecheck`

---

### Task 20: CREATE `src/drivers/postgres-js.driver.ts`
- **IMPLEMENT**: Adapter for `postgres.js` (porsager/postgres) using `sql.unsafe()`
- **IMPORTS**: `import type { Sql } from "postgres"` (type-only)
- **CONTENT**:
```typescript
import type { Sql } from "postgres"
import type { MigrationDriver } from "./driver.types.js"

export const fromPostgresJs = (sql: Sql): MigrationDriver => ({
  exec: async (s: string): Promise<void> => { await sql.unsafe(s) },
  query: async <T = Record<string, unknown>>(s: string, params: unknown[] = []): Promise<T[]> =>
    sql.unsafe(s, params as any) as Promise<T[]>,
})
```
- **VALIDATE**: `pnpm typecheck`

---

### Task 21: CREATE `src/index.ts`
- **IMPLEMENT**: Public API barrel — export only what consumers need
- **EXPORTS**:
  - `createMigrator` factory function (creates `MigratorService` with validated options)
  - `defineConfig` (re-export from types)
  - All result types and `MigratorOptions`
  - `InconsistentDatabaseError`
  - **Do NOT** export internal classes (`EvolutionFileService`, etc.)
- **`createMigrator` factory**:
```typescript
export const createMigrator = (driver: MigrationDriver, options: MigratorOptions): MigratorService => {
  const validated = migratorOptionsValidator.parse(options)
  return new MigratorService(driver, validated)
}
```
- **VALIDATE**: `pnpm build` — check dist/ contains expected files

---

### Task 22: CREATE `bin/db-evolutions.ts`
- **IMPLEMENT**: CLI entrypoint loaded via Node.js
- **COMMANDS**: `apply [--apply]`, `status`, `resolve <id>`
- **CONFIG LOADING**: Use `jiti` to load `evolutions.config.ts` / `.js` from process.cwd()
- **CONTENT OUTLINE**:
```typescript
#!/usr/bin/env node
import { createJiti } from "jiti"
import { createMigrator } from "../src/index.js"
import type { MigratorOptions } from "../src/types.js"
import type { MigrationDriver } from "../src/drivers/driver.types.js"

const jiti = createJiti(import.meta.url)

interface EvolutionsConfig {
  driver: MigrationDriver
  options: MigratorOptions
}

const loadConfig = async (): Promise<EvolutionsConfig> => {
  for (const name of ['evolutions.config.ts', 'evolutions.config.js', 'evolutions.config.mjs']) {
    try { return (await jiti.import(`${process.cwd()}/${name}`, { default: true })) as EvolutionsConfig }
    catch { continue }
  }
  throw new Error('No evolutions.config.ts found in current directory')
}

const main = async (): Promise<void> => {
  const [,, command, ...args] = process.argv
  const { driver, options } = await loadConfig()
  const migrator = createMigrator(driver, options)

  if (command === 'apply') {
    const autoApply = args.includes('--apply')
    const result = await migrator.apply({ ...options, autoApply: autoApply || options.autoApply })
    console.log(JSON.stringify(result, null, 2))
  } else if (command === 'status') {
    const result = await migrator.status()
    console.log(JSON.stringify(result, null, 2))
  } else if (command === 'resolve') {
    const id = parseInt(args[0] ?? '', 10)
    if (isNaN(id)) { console.error('Usage: db-evolutions resolve <id>'); process.exit(1) }
    const result = await migrator.resolve(id)
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.error('Usage: db-evolutions <apply [--apply] | status | resolve <id>>')
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
```
- **VALIDATE**: `pnpm build && node dist/bin/db-evolutions.js --help` (expect error message, not crash)

---

### Task 23: FINAL BUILD AND TEST
- **RUN**: `pnpm install && pnpm build && pnpm test`
- **RUN**: `pnpm typecheck`
- **VALIDATE**: All tests pass, no type errors, dist/ contains all expected files

---

### Task 24: UPDATE `NOW.md`
- **ADD**: Session end entry per `.agents/guidance/now.md` — timestamp, task description, actions taken, open questions, next steps

---

## TESTING STRATEGY

### Unit Tests (co-located `.spec.ts` files, no DB)
- `evolution.parser.spec.ts` — all parsing edge cases, hash correctness
- `evolution.resolver.spec.ts` — directory resolution, numeric sort, fallback logic

### Integration Tests (real SQLite via better-sqlite3 in-memory)
- `migrator.service.spec.ts` — full apply/rollback/resolve/status workflows (includes db_evolutions state transitions)
- `better-sqlite3.driver.spec.ts` — adapter contract compliance

### Edge Cases to Cover
- Empty evolutions directory (no files)
- Evolution files with only Up section (no Down)
- Evolution files with `;;` escaped semicolons
- Hash change at first evolution (id=1) — rolls back ALL, reapplies ALL
- Hash change at last evolution (id=N) — rolls back only id=N, reapplies id=N
- `apply()` called when no changes needed — returns `{ applied: [], rolledBack: [] }`
- `tableName` with custom value
- `autoApply=false` returns conflict without touching DB
- `resolve()` on non-existent id returns `{ status: "failure" }`

---

## VALIDATION COMMANDS

### Level 1: Type Check
```bash
pnpm typecheck
```

### Level 2: Unit & Integration Tests
```bash
pnpm test
```

### Level 3: Coverage
```bash
pnpm test:coverage
```

### Level 4: Build Validation
```bash
pnpm build
ls dist/index.js dist/index.cjs dist/index.d.ts
ls dist/drivers/pg.driver.js dist/drivers/better-sqlite3.driver.js
```

### Level 5: Package Export Validation
```bash
npx @arethetypeswrong/cli --pack .
```

### Level 6: CLI Smoke Test
```bash
node dist/bin/db-evolutions.js status 2>&1 | grep -i "config"
```

---

## ACCEPTANCE CRITERIA

- [ ] `pnpm test` passes — all unit and integration tests green
- [ ] `pnpm typecheck` passes — zero type errors
- [ ] `pnpm build` produces `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` and all driver variants
- [ ] `createMigrator` + `fromBetterSqlite3` applies 3 sequential migrations to an in-memory SQLite DB
- [ ] MD5 hash change in file 2 of 4 triggers rollback of 4→3→2 and reapply of 2→3→4 when `autoApply=true`
- [ ] `apply()` returns `{ status: "conflict" }` without DB mutation when `autoApply=false` and hash changes
- [ ] `apply()` throws `InconsistentDatabaseError` when any row is stuck in `applying_up` or `applying_down`
- [ ] `resolve(id)` unsticks a stuck migration
- [ ] `status()` never mutates the database
- [ ] CLI `db-evolutions apply --apply` invokes `apply({ autoApply: true })`
- [ ] `db-evolutions status` outputs JSON without errors (given a valid config)
- [ ] Type-specific directory (`mydb.postgresql/`) takes priority over generic (`mydb/`)
- [ ] Table initialization dog-fooded through `driver.exec()` with db-type-specific SQL
- [ ] All `.agents` architectural constraints honoured: Gather/Compute/Persist, direct driver access, CQRS, Zod validators, result union types, no trailing semicolons

---

## COMPLETION CHECKLIST

- [ ] `NOW.md` session start entry written (Task 0)
- [ ] All tasks completed top-to-bottom
- [ ] `pnpm test` — all tests pass
- [ ] `pnpm typecheck` — zero errors
- [ ] `pnpm build` — dist/ complete
- [ ] `@arethetypeswrong/cli` — no export resolution errors
- [ ] Architectural constraints checked against `.agents/general.md`
- [ ] No trailing semicolons in TypeScript files
- [ ] All service methods have explicit return type annotations
- [ ] All async methods use `async` keyword explicitly
- [ ] Test files named `{source}.spec.ts`, colocated with source
- [ ] `NOW.md` session end entry written (Task 24)

---

## NOTES

**Why MD5 and not SHA-1**: Play Framework uses SHA-1, but the user explicitly specified MD5 for this library. MD5 is fine for detecting *accidental* file changes (not a security primitive here).

**Why down-first hash**: `md5(down.trim() + up.trim())` matches Play's SHA-1 convention of down-first. This means changing only the Down section changes the hash and triggers reapply — intentional behavior.

**Why `InconsistentDatabaseError` is a thrown exception**: The presence of a stuck migration is a genuinely *unexpected* state — it means a previous run crashed mid-execution. Throwing ensures the application does not silently start with a partially-applied schema. This aligns with `.agents/formatting.md`'s guidance that exceptions are for unexpected failures.

**Why Gather/Compute/Persist matters here**: The compute phase (`findFirstDivergence`, `buildOperationPlan`) is a pure function. It can be unit-tested without any DB or filesystem. The persist phase can fail partway through, but because state is recorded before each operation, recovery via `resolve()` is always possible.

**Why no repository layer**: The `db_evolutions` table has a handful of simple SQL operations (insert, update state, delete, select all). A dedicated `EvolutionRepository` class would add indirection without value. `MigratorService` calls `driver.query()` and `driver.exec()` directly.

**Why dog-food table initialization**: The `CREATE TABLE IF NOT EXISTS` DDL for `db_evolutions` runs through `driver.exec()` — the exact same path user migration scripts take. This validates early that the driver adapter works correctly with the user's database before any migrations run. Different databases need different DDL syntax (e.g., `DEFAULT CURRENT_TIMESTAMP` vs `DEFAULT NOW()`), so init scripts are db-type-specific files in `src/sql/`.

**`splitStatements` shared between parser and pg driver**: The `pg` adapter needs to split multi-statement SQL before calling `client.query()`. Export `splitStatements` from `evolution.parser.ts` so the pg adapter can import it.

**Confidence Score**: 9/10 for one-pass implementation success. The main risk is edge cases in `splitStatements` (escaped semicolons, semicolons inside string literals in DDL). The test suite for `evolution.parser.spec.ts` must be especially thorough on this.
