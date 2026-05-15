import { Effect } from "effect"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { UnknownException } from "effect/Cause"

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EvolutionFileRef {
  id: number
  filePath: string
}

// ── Public API ─────────────────────────────────────────────────────────────────

export const resolveEvolutionFiles = (evolutionsRoot: string, dbName: string, dbType?: string): Effect.Effect<EvolutionFileRef[], UnknownException, never> => {
  const dir = resolveDirectory(evolutionsRoot, dbName, dbType)
  if (!existsSync(dir)) return Effect.succeed([])

  return Effect.try(() =>
    readdirSync(dir)
      .filter(f => /^\d+\.sql$/i.test(f))
      .map(f => ({ id: parseInt(f, 10), filePath: join(dir, f) }))
      .sort((a, b) => a.id - b.id)
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const resolveDirectory = (evolutionsRoot: string, dbName: string, dbType?: string): string => {
  if (dbType) {
    const typeSpecific = join(evolutionsRoot, `${dbName}.${dbType}`)
    if (existsSync(typeSpecific)) return typeSpecific
  }
  return join(evolutionsRoot, dbName)
}
