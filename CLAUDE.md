# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`db-evolutions` is a TypeScript library that brings Play Framework's "evolutions" pattern to Node.js. Migration files are numbered incrementally (`1.sql`, `2.sql`, …), each with a `-- ###!Ups` section and a `-- ###!Downs` section. The library applies them in order, tracks state in a `db_evolutions` database table, and when a file's MD5 hash changes it rolls back from the highest applied migration down to the changed one, then reapplies forward. A pluggable `MigrationDriver` interface supports any SQL-capable database. Ships with adapters for PostgreSQL (`pg`, `postgres.js`), SQLite (`better-sqlite3`, `node:sqlite`) and a CLI binary.

**Implementation plan**: `.agents/plans/db-migrations-project.md` — read before starting any implementation work.

---

## Tech Stack

| Technology | Purpose |
|------------|---------|
| TypeScript (NodeNext, strict) | Library language |
| `zod` | Runtime validators + inferred types for every model |
| `jiti` | Load `evolutions.config.ts` at runtime in the CLI |
| `tsup` | Dual ESM/CJS build with `.d.ts` generation |
| `vitest` | Test runner |
| `better-sqlite3` | Dev/test dep + optional peer dep for SQLite adapter |
| `pg`, `postgres` | Optional peer deps for PostgreSQL adapters |
| `pnpm` | Package manager |

---

## Commands

```bash
# Build (ESM + CJS + .d.ts)
pnpm build

# Watch mode
pnpm dev

# Run all tests
pnpm test

# Run a single test file
pnpm test src/evolution.parser.spec.ts

# Watch tests
pnpm test:watch

# Coverage
pnpm test:coverage

# Type-check only (no emit)
pnpm typecheck

# Validate package exports (run after build)
npx @arethetypeswrong/cli --pack .

# CLI smoke test
node dist/bin/db-evolutions.js status 2>&1
```

---

## Architecture

The library has three distinct layers enforced as an invariant:

### 1. Gather / Compute / Persist (core invariant)

`MigratorService.apply()` — and all mutating commands — must strictly observe this sequence:

- **Gather**: read evolution files from disk (`EvolutionFileService`) AND all `db_evolutions` rows from the DB (via `driver.query()`). All IO happens here.
- **Compute**: pure diff logic — no additional IO is permitted once this phase begins. Produces an ordered operation plan.
- **Persist**: execute the plan: roll back changed/removed migrations (high → low), apply pending/changed migrations (low → high), updating `db_evolutions` state before and after each step.

### 2. Direct Driver Access (no repository layer)

`MigratorService` calls `driver.query()` and `driver.exec()` directly for all `db_evolutions` bookkeeping. The SQL is simple enough that a separate repository class would be unnecessary indirection. Table initialization (`CREATE TABLE IF NOT EXISTS`) is dog-fooded through `driver.exec()` — the same execution path user migrations take.

### 3. CQRS

- **Queries** (read-only): `status()` — never mutates `db_evolutions`.
- **Commands** (mutating): `apply()`, `rollback()`, `resolve()` — never used for reads.

### 4. Driver Abstraction

All database access is channelled through the two-method `MigrationDriver` interface:

```typescript
interface MigrationDriver {
  exec(sql: string): Promise<void>          // multi-statement DDL, no params
  query<T>(sql: string, params?: unknown[]): Promise<T[]>  // parameterized ledger ops
}
```

Driver adapters (`better-sqlite3`, `node-sqlite`, `pg`, `postgres-js`) are thin wrappers (~10 lines) in `src/drivers/`.

---

## Project Structure

```
src/
  types.ts                    — All Zod validators, inferred types, result unions, error classes
  evolution.parser.ts         — Utility: parse SQL → {up, down}, compute MD5 hash
  evolution.resolver.ts       — Utility: discover & sort *.sql files for a given dbName/dbType
  evolution.file.service.ts   — Service: Gather phase — reads files → Evolution[]
  migrator.service.ts         — Service: apply/rollback/resolve/status orchestration + db_evolutions SQL
  index.ts                    — Public barrel (createMigrator factory + public types)
  drivers/
    driver.types.ts           — MigrationDriver interface
    better-sqlite3.driver.ts  — Adapter
    node-sqlite.driver.ts     — Adapter (Node >= 22.13)
    pg.driver.ts              — Adapter
    postgres-js.driver.ts     — Adapter
  sql/
    init.sqlite.sql           — SQLite CREATE TABLE IF NOT EXISTS for db_evolutions
    init.postgresql.sql       — PostgreSQL CREATE TABLE IF NOT EXISTS for db_evolutions
bin/
  db-evolutions.ts            — CLI: apply / status / resolve, loads evolutions.config.ts via jiti
```

---

## Code Conventions

### TypeScript
- **No trailing semicolons** in `.ts` files.
- **140-character line limit**. Wrap only when it aids comprehension or exceeds the limit.
- **`async` keyword required** on every function/method that returns a `Promise`.
- Explicit return types on all service methods.
- Avoid fall-through `if` — always use `if / else`.

### Zod validators (single source of truth for every type)
```typescript
export const evolutionValidator = z.object({
  id: z.number().int().positive(),
  up: z.string(),
  down: z.string(),
  hash: z.string(),
}).strict()
export type Evolution = z.infer<typeof evolutionValidator>
```

### Result union types (expected failures — not exceptions)
```typescript
interface ApplySuccessResult { status: "success"; applied: number[]; rolledBack: number[] }
interface ApplyConflictResult { status: "conflict"; changedAt: number; details: string }
interface ApplyFailureResult  { status: "failure"; error: string; stuckAt?: number }
type ApplyResult = ApplySuccessResult | ApplyConflictResult | ApplyFailureResult
```

### Exceptions (unexpected / unrecoverable state only)
`InconsistentDatabaseError` is thrown when `db_evolutions` has rows stuck in `applying_up` or `applying_down`. Expected failures (e.g., hash conflict when `autoApply=false`) use the result union pattern above, not exceptions.

### File naming
| Object type | File suffix | Example |
|-------------|-------------|---------|
| Service | `.service.ts` | `migrator.service.ts` |
| Utility (parser/resolver) | `{domain}.{role}.ts` | `evolution.parser.ts` |
| Driver adapter | `.driver.ts` | `pg.driver.ts` |
| Test | `.spec.ts` (colocated) | `evolution.parser.spec.ts` |

### Information order in files
Most abstract / highest-level constructs go at the top; private helpers at the bottom.

---

## Testing

Tests use `vitest` with `describe` + `it` blocks, colocated as `{source}.spec.ts`.

- **Unit tests** (no DB): `evolution.parser.spec.ts`, `evolution.resolver.spec.ts`
- **Integration tests** (real SQLite in-memory): `migrator.service.spec.ts`, `better-sqlite3.driver.spec.ts`
- Use `better-sqlite3(':memory:')` for integration tests. Never mock the DB when a real in-memory DB is feasible.
- Clean up SQLite connections in `afterEach(() => db.close())`.
- Resolver tests use `os.tmpdir()` temp dirs, cleaned up in `afterEach`.

---

## Key Gotchas

- **`pg` multi-statement exec**: `pg.Pool.query()` does not support multi-statement SQL. The `pg` driver's `exec()` must acquire a client from the pool, split statements (via `splitStatements` from `evolution.parser.ts`), and call `client.query()` per statement, releasing the client in `finally`.
- **`node:sqlite` exec return**: `db.exec()` returns `void` (unlike `better-sqlite3` which returns `this`). Both adapters discard the return value.
- **`node:sqlite` Node version**: Requires Node.js >= 22.13.
- **`splitStatements` shared export**: Export from `evolution.parser.ts` — the `pg` adapter depends on it.
- **Hash algorithm**: MD5 of `down.trim() + up.trim()` (down-first, matching Play convention). Changing only the Down section changes the hash and triggers re-migration — intentional.
- **Conflict vs. new files**: A divergence (hash mismatch at an existing record) is a conflict. New files beyond existing records are not a conflict — they are applied forward without rollback.
- **`tableName` safety**: The `db_evolutions` table name comes from `options.tableName`. Validate it matches `/^[a-zA-Z_][a-zA-Z0-9_]*$/` before interpolating into DDL (SQL does not support parameterized identifiers).
- **Numeric file sort**: `resolveEvolutionFiles` must parse filenames to `parseInt` — `10.sql` must sort after `2.sql`, not between `1.sql` and `2.sql`.

---

## NOW.md

Every work session must append a start entry and an end entry to `NOW.md` in the project root (create if absent). See `.agents/guidance/now.md` for the required format. This file is **strictly append-only**.

---

## Validation Before Committing

```bash
pnpm typecheck      # zero type errors
pnpm test           # all tests green
pnpm build          # dist/ complete
```

---

## On-Demand Context

| Topic | File |
| :---- | :---- |
| General architecture principles | `.agents/general.md` |
| Code formatting & information order | `.agents/formatting.md` |
| Object types & naming conventions | `.agents/object-types.md` |
| TypeScript coding rules | `.agents/languages/typescript/typescript.md` |
| Testing standards | `.agents/languages/typescript/typescript-testing.md` |
| Tool preferences (pnpm/vitest) | `.agents/languages/typescript/typescript-tools.md` |
| Session logging (NOW.md) | `.agents/guidance/now.md` |
| Full implementation plan | `.agents/plans/db-migrations-project.md` |
