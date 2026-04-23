import { createHash } from "node:crypto"
import type { Evolution } from "./types.js"

// ── Public API ─────────────────────────────────────────────────────────────────

export const parseEvolutionFile = (id: number, content: string): Evolution => {
  const { up, down } = extractSections(content)
  return { id, up, down, hash: computeHash(up, down) }
}

export const computeHash = (up: string, down: string): string =>
  createHash("md5")
    .update(down.trim() + up.trim())
    .digest("hex")

/** Split SQL on `;` boundaries, but treat `;;` as a literal semicolon (not a statement boundary). */
export const splitStatements = (sql: string): string[] =>
  sql
    .split(/(?<!;);(?!;)/)
    .map(s => s.trim())
    .filter(s => s.length > 0)

// ── Helpers ────────────────────────────────────────────────────────────────────

const UPS_MARKER = /^(?:--|#).*###!Ups/m
const DOWNS_MARKER = /^(?:--|#).*###!Downs/m

const extractSections = (content: string): { up: string; down: string } => {
  const lines = content.split("\n")
  let section: "up" | "down" | "none" = "none"
  const upLines: string[] = []
  const downLines: string[] = []

  for (const line of lines) {
    if (UPS_MARKER.test(line)) {
      section = "up"
    } else if (DOWNS_MARKER.test(line)) {
      section = "down"
    } else if (section === "up") {
      upLines.push(line)
    } else if (section === "down") {
      downLines.push(line)
    }
  }

  return { up: upLines.join("\n"), down: downLines.join("\n") }
}
