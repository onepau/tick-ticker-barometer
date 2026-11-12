// Minimal D1Database stand-in backed by Node's built-in SQLite (node:sqlite),
// so the price helpers run their real SQL against the real migration.
// Covers only the D1 surface the helpers use: prepare/bind/first/all/run/exec.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export function migrationSql(name: string): string {
  return readFileSync(resolve(root, 'migrations', name), 'utf8');
}

type Value = string | number | null;

class Stmt {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: Value[] = [],
  ) {}
  bind(...params: Value[]): Stmt {
    return new Stmt(this.db, this.sql, params);
  }
  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row ? { ...row } : null) as T | null;
  }
  async all<T>(): Promise<{ results: T[]; success: true }> {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { results: rows.map((r) => ({ ...r })) as T[], success: true };
  }
  async run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) },
    };
  }
}

export interface TestDb {
  d1: D1Database;
  raw: DatabaseSync;
}

/** Migrations the price tables depend on: registry (0005–0006) and prices (0007+). */
export const PRICE_MIGRATIONS = [
  '0005_registry_entities.sql',
  '0006_watch_references.sql',
  '0007_price_schema.sql',
  '0008_price_sources_manual.sql',
  '0009_run_reports.sql',
];

/** Fresh in-memory database with the registry and price migrations applied. */
export function freshPriceDb(migrations: string[] = PRICE_MIGRATIONS): TestDb {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON;');
  for (const m of migrations) raw.exec(migrationSql(m));
  const d1 = {
    prepare: (sql: string) => new Stmt(raw, sql),
    exec: async (sql: string) => raw.exec(sql),
  } as unknown as D1Database;
  return { d1, raw };
}
