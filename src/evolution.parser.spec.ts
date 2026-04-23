import { describe, expect, it } from "vitest"
import { computeHash, parseEvolutionFile, splitStatements } from "./evolution.parser.js"

const STANDARD_FILE = `
-- ###!Ups
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);

-- ###!Downs
DROP TABLE users;
`

const HASH_COMMENT_FILE = `
# ###!Ups
CREATE TABLE posts (id INTEGER PRIMARY KEY);
# ###!Downs
DROP TABLE posts;
`

const MULTI_SECTION_FILE = `
-- ###!Ups
CREATE TABLE a (id INTEGER PRIMARY KEY);
-- ###!Downs
DROP TABLE a;
-- ###!Ups
CREATE TABLE b (id INTEGER PRIMARY KEY);
-- ###!Downs
DROP TABLE b;
`

describe("parseEvolutionFile", () => {
  it("parses standard -- ###!Ups / -- ###!Downs markers", () => {
    const result = parseEvolutionFile(1, STANDARD_FILE)
    expect(result.id).toBe(1)
    expect(result.up).toContain("CREATE TABLE users")
    expect(result.down).toContain("DROP TABLE users")
  })

  it("parses # ###!Ups / # ###!Downs hash-comment markers", () => {
    const result = parseEvolutionFile(2, HASH_COMMENT_FILE)
    expect(result.up).toContain("CREATE TABLE posts")
    expect(result.down).toContain("DROP TABLE posts")
  })

  it("concatenates multiple ###!Ups sections", () => {
    const result = parseEvolutionFile(3, MULTI_SECTION_FILE)
    expect(result.up).toContain("CREATE TABLE a")
    expect(result.up).toContain("CREATE TABLE b")
  })

  it("concatenates multiple ###!Downs sections", () => {
    const result = parseEvolutionFile(3, MULTI_SECTION_FILE)
    expect(result.down).toContain("DROP TABLE a")
    expect(result.down).toContain("DROP TABLE b")
  })

  it("produces empty strings when no markers are present", () => {
    const result = parseEvolutionFile(1, "-- just a comment\nCREATE TABLE foo (id INT);")
    expect(result.up).toBe("")
    expect(result.down).toBe("")
  })

  it("hash is MD5 of down.trim() + up.trim()", () => {
    const result = parseEvolutionFile(1, STANDARD_FILE)
    const expected = computeHash(result.up, result.down)
    expect(result.hash).toBe(expected)
  })

  it("changing only the down section changes the hash", () => {
    const fileA = "-- ###!Ups\nCREATE TABLE x (id INT);\n-- ###!Downs\nDROP TABLE x;"
    const fileB = "-- ###!Ups\nCREATE TABLE x (id INT);\n-- ###!Downs\nDROP TABLE x CASCADE;"
    const a = parseEvolutionFile(1, fileA)
    const b = parseEvolutionFile(1, fileB)
    expect(a.hash).not.toBe(b.hash)
  })
})

describe("computeHash", () => {
  it("uses down-first ordering: MD5(down.trim() + up.trim())", async () => {
    const { createHash } = await import("node:crypto")
    const up = "CREATE TABLE x (id INT);"
    const down = "DROP TABLE x;"
    const expected = createHash("md5")
      .update(down.trim() + up.trim())
      .digest("hex")
    expect(computeHash(up, down)).toBe(expected)
  })
})

describe("splitStatements", () => {
  it("splits on single semicolons", () => {
    const sql = "CREATE TABLE a (id INT); CREATE TABLE b (id INT);"
    expect(splitStatements(sql)).toEqual(["CREATE TABLE a (id INT)", "CREATE TABLE b (id INT)"])
  })

  it("does not split on ;; escaped semicolons", () => {
    const sql = "INSERT INTO t VALUES ('a;;b'); SELECT 1;"
    const parts = splitStatements(sql)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toContain("a;;b")
  })

  it("trims and filters empty segments", () => {
    const sql = "  SELECT 1 ;  ; SELECT 2;  "
    const parts = splitStatements(sql)
    expect(parts).toEqual(["SELECT 1", "SELECT 2"])
  })

  it("returns empty array for blank input", () => {
    expect(splitStatements("")).toEqual([])
    expect(splitStatements("   ")).toEqual([])
  })
})
