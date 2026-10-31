/**
 * Database bootstrap. Uses better-sqlite3 (synchronous, in-process, WAL) which
 * is more than adequate for job/queue state and keeps the MVP free of external
 * services. Migrations are plain SQL applied idempotently at boot.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import { log } from '../logger.js';
import * as schema from './schema.js';

const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY,
     status TEXT NOT NULL,
     engine TEXT NOT NULL,
     source_id TEXT NOT NULL,
     source_page_url TEXT NOT NULL,
     file_url TEXT NOT NULL,
     file_name TEXT NOT NULL,
     relative_path TEXT NOT NULL,
     absolute_path TEXT NOT NULL,
     bytes_total INTEGER,
     bytes_downloaded INTEGER NOT NULL DEFAULT 0,
     speed_bps INTEGER NOT NULL DEFAULT 0,
     eta_seconds INTEGER,
     rights_note TEXT,
     ref_json TEXT NOT NULL DEFAULT '{}',
     error TEXT,
     error_code TEXT,
     attempts INTEGER NOT NULL DEFAULT 0,
     etag TEXT,
     last_modified TEXT,
     accept_ranges INTEGER NOT NULL DEFAULT 1,
     aria2_gid TEXT,
     created_at TEXT NOT NULL,
     started_at TEXT,
     completed_at TEXT,
     updated_at TEXT NOT NULL
   );`,
  `CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status);`,
  `CREATE INDEX IF NOT EXISTS jobs_created_idx ON jobs (created_at);`,
  `CREATE TABLE IF NOT EXISTS library_items (
     id TEXT PRIMARY KEY,
     root TEXT NOT NULL,
     relative_path TEXT NOT NULL,
     file_name TEXT NOT NULL,
     kind TEXT NOT NULL,
     size_bytes INTEGER NOT NULL,
     extension TEXT NOT NULL,
     modified_at TEXT NOT NULL,
     title TEXT NOT NULL,
     year INTEGER,
     season_number INTEGER,
     episode_number INTEGER,
     probe_json TEXT,
     subtitles_json TEXT NOT NULL DEFAULT '[]',
     missing INTEGER NOT NULL DEFAULT 0,
     added_at TEXT NOT NULL
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS library_relative_idx ON library_items (root, relative_path);`,
  `CREATE INDEX IF NOT EXISTS library_missing_idx ON library_items (missing);`,
  `CREATE TABLE IF NOT EXISTS playback_progress (
     item_id TEXT PRIMARY KEY,
     position_seconds REAL NOT NULL DEFAULT 0,
     duration_seconds REAL,
     completed INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT NOT NULL
   );`,
  `CREATE TABLE IF NOT EXISTS inspections (
     url_hash TEXT PRIMARY KEY,
     url TEXT NOT NULL,
     result_json TEXT NOT NULL,
     fetched_at TEXT NOT NULL
   );`,
];

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let rawInstance: Database.Database | null = null;

export function initDatabase(): { db: ReturnType<typeof drizzle<typeof schema>>; raw: Database.Database } {
  if (dbInstance && rawInstance) return { db: dbInstance, raw: rawInstance };

  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const raw = new Database(config.databasePath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  for (const statement of MIGRATIONS) raw.exec(statement);

  rawInstance = raw;
  dbInstance = drizzle(raw, { schema });
  log.debug('Database ready', { path: config.databasePath, tables: MIGRATIONS.length });
  return { db: dbInstance, raw };
}

export function getDb() {
  if (!dbInstance || !rawInstance) return initDatabase();
  return { db: dbInstance, raw: rawInstance };
}

export function closeDatabase(): void {
  rawInstance?.close();
  rawInstance = null;
  dbInstance = null;
}

export { schema };
