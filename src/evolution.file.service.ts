import { readFileSync } from "node:fs"
import { parseEvolutionFile } from "./evolution.parser.js"
import { resolveEvolutionFiles } from "./evolution.resolver.js"
import type { Evolution, MigratorOptions } from "./types.js"

export class EvolutionFileService {
  constructor(private readonly options: MigratorOptions) {}

  fetchEvolutions(): Evolution[] {
    const files = resolveEvolutionFiles(this.options.evolutionsRoot, this.options.dbName, this.options.dbType)
    return files.map(({ id, filePath }) => parseEvolutionFile(id, readFileSync(filePath, "utf-8")))
  }
}
