/**
 * SQLite schema (Drizzle). Four tables, no Redis, no message queue — the
 * blueprint explicitly rules out heavier infrastructure for the MVP.
 */
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    status: text('status').notNull(),
    engine: text('engine').notNull(),
    sourceId: text('source_id').notNull(),
    sourcePageUrl: text('source_page_url').notNull(),
    fileUrl: text('file_url').notNull(),
    fileName: text('file_name').notNull(),
    relativePath: text('relative_path').notNull(),
    absolutePath: text('absolute_path').notNull(),
    bytesTotal: integer('bytes_total'),
    bytesDownloaded: integer('bytes_downloaded').notNull().default(0),
    speedBps: integer('speed_bps').notNull().default(0),
    etaSeconds: integer('eta_seconds'),
    rightsNote: text('rights_note'),
    refJson: text('ref_json').notNull().default('{}'),
    error: text('error'),
    errorCode: text('error_code'),
    attempts: integer('attempts').notNull().default(0),
    etag: text('etag'),
    lastModified: text('last_modified'),
    acceptRanges: integer('accept_ranges').notNull().default(1),
    aria2Gid: text('aria2_gid'),
    createdAt: text('created_at').notNull(),
    startedAt: text('started_at'),
    completedAt: text('completed_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    statusIdx: index('jobs_status_idx').on(t.status),
    createdIdx: index('jobs_created_idx').on(t.createdAt),
  }),
);

export const libraryItems = sqliteTable(
  'library_items',
  {
    id: text('id').primaryKey(),
    root: text('root').notNull(),
    relativePath: text('relative_path').notNull(),
    fileName: text('file_name').notNull(),
    kind: text('kind').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    extension: text('extension').notNull(),
    modifiedAt: text('modified_at').notNull(),
    title: text('title').notNull(),
    year: integer('year'),
    seasonNumber: integer('season_number'),
    episodeNumber: integer('episode_number'),
    probeJson: text('probe_json'),
    subtitlesJson: text('subtitles_json').notNull().default('[]'),
    missing: integer('missing').notNull().default(0),
    addedAt: text('added_at').notNull(),
  },
  (t) => ({
    relativeIdx: index('library_relative_idx').on(t.relativePath),
    missingIdx: index('library_missing_idx').on(t.missing),
  }),
);

export const playbackProgress = sqliteTable('playback_progress', {
  itemId: text('item_id').primaryKey(),
  positionSeconds: real('position_seconds').notNull().default(0),
  durationSeconds: real('duration_seconds'),
  completed: integer('completed').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
});

export const inspections = sqliteTable('inspections', {
  urlHash: text('url_hash').primaryKey(),
  url: text('url').notNull(),
  resultJson: text('result_json').notNull(),
  fetchedAt: text('fetched_at').notNull(),
});
