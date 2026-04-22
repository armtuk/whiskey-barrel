# NOW.md — db-evolutions Session Log

---

## Session Start: 2026-04-22T09:57:29-0700

**Prompt:** Execute Phase 1 (Project Scaffold) of the db-evolutions implementation plan.

**Understood:** Set up all project tooling and config files — `NOW.md`, `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts` — then run `pnpm install` to install all dependencies and validate the scaffold is ready for Phase 2.

---

## Session End: 2026-04-22T09:57:29-0700

**Task:** Phase 1 — Project Scaffold

**Actions completed:**
- Created `NOW.md` (this file)
- Created `package.json` — dual ESM/CJS exports, optional peer deps for `pg`/`postgres`/`better-sqlite3`, `bin` entry, `pnpm.onlyBuiltDependencies` to allow native builds
- Created `tsconfig.json` — NodeNext module resolution, strict mode
- Created `tsup.config.ts` — 6 entry points (index + 4 drivers + bin), ESM+CJS, dts, sourcemap
- Created `vitest.config.ts` — node environment, v8 coverage
- Created `.npmrc`
- Resolved `better-sqlite3` native build issue: upgraded from `^9.0.0` to `^12.0.0` (prebuilt binaries for Node 24 arm64), added `pnpm.onlyBuiltDependencies`, clean reinstalled — `better-sqlite3` now imports and queries correctly
- Added `node-gyp` as devDependency (needed for native builds if prebuilts are absent in future)

**Open questions / notes:**
- `better-sqlite3` pinned to `^12.0.0` in devDependencies (plan specified `^9.0.0`); peer dep range left as `>=9.0.0` to remain broad
- `node-gyp` was added to devDependencies (not in plan) — required to build better-sqlite3 from source as fallback

**Next steps:** Phase 2 — Types & Domain Model (`src/types.ts`, `src/drivers/driver.types.ts`)

**Context summary:** Brand-new TypeScript library project. Scaffold complete. All deps installed and verified. No source files exist yet.

---

## Session Start: 2026-04-22T16:17:42-0700

**Prompt:** Implement Phase 2 — Types & Domain Model.

**Understood:** Create `src/drivers/driver.types.ts` (MigrationDriver interface) and `src/types.ts` (all Zod validators, inferred types, result unions, error class, MigratorOptions).

---

## Session End: 2026-04-22T16:18:00-0700

**Task:** Phase 2 — Types & Domain Model

**Actions completed:**
- Created `src/drivers/driver.types.ts` — two-method `MigrationDriver` interface (`exec`, `query<T>`)
- Created `src/types.ts` — all Zod validators and inferred types:
  - `evolutionStateValidator` / `EvolutionState` (enum: applying_up | applied | applying_down)
  - `evolutionValidator` / `Evolution` (id, up, down, hash)
  - `evolutionRecordValidator` / `EvolutionRecord` (full db_evolutions row shape)
  - `migratorOptionsValidator` / `MigratorOptions` / `MigratorOptionsInput` — includes regex validation on `tableName`
  - `defineConfig` helper (accepts input type for user config files)
  - Result unions: `StatusResult`, `ApplyResult`, `RollbackResult`, `ResolveResult`
  - `InconsistentDatabaseError` exception class
- `pnpm typecheck` passes with zero errors

**Deviations from plan:**
- Added `MigratorOptionsInput = z.input<typeof migratorOptionsValidator>` alongside `MigratorOptions = z.infer<...>` so `defineConfig` accepts partial options (with defaults filled at parse time in the factory)
- Embedded `tableName` regex validation directly in the Zod validator rather than as a runtime check in the service
- Added `RollbackResult` union type (plan had `ApplyResult` covering rollback implicitly, but separate type is cleaner)

**Next steps:** Phase 3 — Core Utilities (`evolution.parser.ts`, `evolution.parser.spec.ts`, `evolution.resolver.ts`, `evolution.resolver.spec.ts`)

---
