/**
 * A minimal D1Database stand-in on Node's built-in SQLite, for tests. Covers the
 * calls the registry makes (prepare → bind → all / first / run) and applies the real
 * migrations, so tests exercise the actual schema and constraints.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const MIGRATIONS_DIR = new URL("../../../migrations/", import.meta.url);

class Statement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(this.db, this.sql, params as SQLInputValue[]);
  }

  async all<T>(): Promise<{
    results: T[];
    success: true;
    meta: Record<string, unknown>;
  }> {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return {
      results: rows.map((r) => ({ ...r })) as T[],
      success: true,
      meta: {},
    };
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return row ? ({ ...row } as T) : null;
  }

  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(r.changes) } };
  }
}

export interface TestD1 {
  db: D1Database;
  raw: DatabaseSync;
  /** How many statements have been prepared, to prove a cache hit skipped D1. */
  prepared: () => number;
}

export function createTestD1(): TestD1 {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS_DIR)
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    raw.exec(readFileSync(new URL(f, MIGRATIONS_DIR), "utf8"));
  }
  let count = 0;
  const db = {
    prepare(sql: string) {
      count++;
      return new Statement(raw, sql);
    },
  } as unknown as D1Database;
  return { db, raw, prepared: () => count };
}
