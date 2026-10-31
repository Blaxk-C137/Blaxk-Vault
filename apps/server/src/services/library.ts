/**
 * Local library service (blueprint §5.5).
 *
 *  - Indexes only directories the operator approved (MEDIA_ROOTS / settings).
 *  - Understands the predictable layout BlaxkVault itself writes, and degrades
 *    gracefully for hand-curated folders.
 *  - Probes each new file so the UI can show real duration/resolution, and can
 *    honestly say "this codec will not play in your browser".
 *  - Never follows a symlink out of a media root.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { LibraryItem, LibraryScanResult, LocalCopy, MediaKind, MediaProbeSummary, PlaybackProgress, SubtitleTrack } from '@blaxkvault/shared';
import { normalizeTitle, titleAgreement } from '@blaxkvault/shared';
import { getDb } from '../db/index.js';
import { libraryItems, playbackProgress } from '../db/schema.js';
import { log } from '../logger.js';
import { AppError, notFound } from '../lib/errors.js';
import { classifyRelativePath, isWithinRoot } from '../security/paths.js';
import { probeLocalFile } from '../engine/probe.js';
import { getMediaRoots } from './settings.js';

const MEDIA_EXTENSIONS = new Set([
  'mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv', 'avi', 'mpg', 'mpeg', 'ts', 'm2ts',
  'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav',
]);
const SUBTITLE_EXTENSIONS = new Set(['vtt', 'srt', 'ass', 'ssa']);
const MAX_FILES_PER_SCAN = 20_000;
const MAX_DEPTH = 8;

type ItemRow = typeof libraryItems.$inferSelect;

function idFor(root: string, relativePath: string): string {
  return crypto.createHash('sha1').update(`${root}::${relativePath}`).digest('hex').slice(0, 20);
}

function rowToItem(row: ItemRow, progress?: typeof playbackProgress.$inferSelect): LibraryItem {
  const probe = row.probeJson ? (JSON.parse(row.probeJson) as MediaProbeSummary) : undefined;
  let subtitles: SubtitleTrack[] = [];
  try {
    subtitles = JSON.parse(row.subtitlesJson) as SubtitleTrack[];
  } catch {
    subtitles = [];
  }
  return {
    id: row.id,
    relativePath: row.relativePath,
    fileName: row.fileName,
    kind: row.kind as MediaKind | 'other',
    sizeBytes: row.sizeBytes,
    extension: row.extension,
    modifiedAt: row.modifiedAt,
    title: row.title,
    year: row.year ?? undefined,
    seasonNumber: row.seasonNumber ?? undefined,
    episodeNumber: row.episodeNumber ?? undefined,
    probe,
    subtitleTracks: subtitles,
    missing: row.missing === 1,
    inProgress: Boolean(progress && !progress.completed && progress.positionSeconds > 5),
    unsupportedReason:
      probe && !probe.browserPlayable
        ? `This file is a ${probe.container ?? 'container'} file${probe.videoCodec ? ` (${probe.videoCodec})` : ''} that browsers cannot play directly. It is stored and can be played in an external player such as VLC or mpv.`
        : undefined,
  };
}

/* --------------------------------- scan ---------------------------------- */

export async function scanLibrary(options: { probe?: boolean } = {}): Promise<LibraryScanResult> {
  const started = Date.now();
  // Roots can legitimately overlap (a download directory inside an existing
  // library, for example). Walk the shallowest first and skip any root that is
  // already covered, so one file never produces two library entries.
  const allRoots = getMediaRoots().map((root) => path.resolve(root));
  const roots = allRoots
    .sort((a, b) => a.split(path.sep).length - b.split(path.sep).length)
    .filter((root, _index, sorted) => !sorted.some((other) => other !== root && isWithinRoot(root, other)));
  const { db } = getDb();
  const existing = db.select().from(libraryItems).all();
  const existingByKey = new Map(existing.map((row) => [`${row.root}::${row.relativePath}`, row]));
  // A row's absolute path is the file's real identity. It survives a change to
  // the media-root list (adding or removing a root, pointing DOWNLOAD_DIR
  // somewhere else), which otherwise looks like "one file removed, one file
  // added" and silently drops the item's id, playback position and added date.
  const existingByAbsolute = new Map(existing.map((row) => [path.resolve(row.root, row.relativePath), row]));

  let fileCount = 0;
  let newItems = 0;
  let removedItems = 0;
  const seen = new Set<string>();
  const matchedIds = new Set<string>();

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack: { dir: string; depth: number }[] = [{ dir: root, depth: 0 }];

    while (stack.length > 0 && fileCount < MAX_FILES_PER_SCAN) {
      const { dir, depth } = stack.pop()!;
      if (depth > MAX_DEPTH) continue;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch (err) {
        log.warn('library.readdir-failed', { dir, message: (err as Error).message });
        continue;
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.name.startsWith('.')) continue;
        if (entry.isSymbolicLink()) {
          // Only follow a symlink when it still resolves inside the root.
          try {
            const real = await fsp.realpath(full);
            if (!isWithinRoot(real, root)) {
              log.warn('library.symlink-skipped', { path: full, reason: 'resolves outside the media root' });
              continue;
            }
          } catch {
            continue;
          }
        }
        if (entry.isDirectory()) {
          stack.push({ dir: full, depth: depth + 1 });
          continue;
        }
        const extension = path.extname(entry.name).slice(1).toLowerCase();
        if (!MEDIA_EXTENSIONS.has(extension)) continue;
        if (entry.name.endsWith('.part')) continue;

        fileCount += 1;
        const relativePath = path.relative(root, full).split(path.sep).join('/');
        const key = `${root}::${relativePath}`;
        seen.add(key);

        let stat: fs.Stats;
        try {
          stat = await fsp.stat(full);
        } catch {
          continue;
        }

        const previous = existingByKey.get(key) ?? existingByAbsolute.get(path.resolve(full));
        if (previous) matchedIds.add(previous.id);
        // The file reached through a different root: same bytes, new key. It must
        // be re-keyed, otherwise the entry keeps a path that no longer resolves
        // and the next scan reports it as vanished.
        const identityMoved = Boolean(previous) && (previous!.root !== root || previous!.relativePath !== relativePath);
        const unchanged = Boolean(previous) && !identityMoved && previous!.sizeBytes === stat.size && previous!.modifiedAt === stat.mtime.toISOString();

        if (!previous) newItems += 1;

        if (previous && unchanged) {
          if (previous.missing === 1) {
            db.update(libraryItems).set({ missing: 0 }).where(eqPath(key)).run();
          }
          continue;
        }

        const subtitleTracks = await findSubtitles(dir, entry.name, root);
        const classified = classifyRelativePath(relativePath);
        const probe = options.probe === false ? previous?.probeJson ? (JSON.parse(previous.probeJson) as MediaProbeSummary) : undefined : await probeLocalFile(full);

        const values = {
          id: previous?.id ?? idFor(root, relativePath),
          root,
          relativePath,
          fileName: entry.name,
          kind: classified.kind,
          sizeBytes: stat.size,
          extension,
          modifiedAt: stat.mtime.toISOString(),
          title: classified.title || path.basename(entry.name, path.extname(entry.name)),
          year: classified.year ?? null,
          seasonNumber: classified.seasonNumber ?? null,
          episodeNumber: classified.episodeNumber ?? null,
          probeJson: probe ? JSON.stringify(probe) : null,
          subtitlesJson: JSON.stringify(subtitleTracks),
          missing: 0,
          addedAt: previous?.addedAt ?? new Date().toISOString(),
        };

        if (identityMoved) {
          // Another row may already hold the key we are about to take (the ghost
          // an earlier root change left behind). It describes the same file, so it
          // goes — the dedupe pass would remove it anyway, but the unique index
          // would reject the update first.
          const occupant = existingByKey.get(key);
          if (occupant && occupant.id !== values.id) {
            db.delete(playbackProgress).where(eq(playbackProgress.itemId, occupant.id)).run();
            db.delete(libraryItems).where(eq(libraryItems.id, occupant.id)).run();
            log.debug('library.duplicate-row-replaced', { root, relativePath });
          }
        }

        db.insert(libraryItems)
          .values(values)
          .onConflictDoUpdate({ target: libraryItems.id, set: values })
          .run();
      }
    }
  }

  for (const row of existing) {
    // Rows matched during the walk were refreshed in place (possibly under a new
    // root, which is why `seen` alone is not enough here).
    if (matchedIds.has(row.id)) continue;
    if (row.missing === 0 && !seen.has(`${row.root}::${row.relativePath}`)) {
      db.update(libraryItems).set({ missing: 1 }).where(eqPath(`${row.root}::${row.relativePath}`)).run();
      removedItems += 1;
      log.debug('library.file-vanished', { root: row.root, relativePath: row.relativePath });
    }
  }

  // Heal duplicates an earlier root change may have left behind: two rows can
  // describe the same absolute file (same bytes, different root). Keep the live
  // row, carry its playback position over, drop the ghosts.
  const duplicatesRemoved = dedupeByAbsolutePath();

  const result: LibraryScanResult = {
    scannedAt: new Date().toISOString(),
    roots,
    fileCount,
    newItems,
    removedItems: removedItems + duplicatesRemoved,
    durationMs: Date.now() - started,
  };
  // A scan that changed nothing is not news — it happens on every start. Report
  // it at debug and only speak up when the library actually moved.
  const changed = result.newItems > 0 || result.removedItems > 0;
  // Only what changed is worth reading: scannedAt and the root list are already in
  // the API response and would just be noise here.
  const payload = {
    files: result.fileCount,
    added: result.newItems,
    removed: result.removedItems,
    duplicatesRemoved,
    tookMs: result.durationMs,
  };
  if (changed) log.info('Library changed', payload);
  else log.debug('Library scan clean', payload);
  return result;
}

/**
 * Remove library rows that point at the same absolute file as another row.
 *
 * This only happens when the media-root list changes between runs: the same file
 * gets a new (root, relativePath) key while the old row is flagged missing. The
 * live row wins; if the kept row has no playback position but a dropped one does,
 * the position moves across so resume history is never lost.
 */
function dedupeByAbsolutePath(): number {
  const { db } = getDb();
  const rows = db.select().from(libraryItems).all();
  const byAbsolute = new Map<string, ItemRow[]>();
  for (const row of rows) {
    const absolute = path.resolve(row.root, row.relativePath);
    const bucket = byAbsolute.get(absolute);
    if (bucket) bucket.push(row);
    else byAbsolute.set(absolute, [row]);
  }

  let removed = 0;
  for (const [absolute, bucket] of byAbsolute) {
    if (bucket.length < 2) continue;
    const keep = bucket.find((row) => row.missing === 0) ?? bucket[0]!;
    for (const row of bucket) {
      if (row.id === keep.id) continue;
      // Move a playback position across rather than losing it with the ghost.
      const droppedProgress = db.select().from(playbackProgress).all().find((p) => p.itemId === row.id);
      const keptProgress = db.select().from(playbackProgress).all().find((p) => p.itemId === keep.id);
      if (droppedProgress && !keptProgress) {
        db.insert(playbackProgress)
          .values({
            itemId: keep.id,
            positionSeconds: droppedProgress.positionSeconds,
            durationSeconds: droppedProgress.durationSeconds,
            completed: droppedProgress.completed,
            updatedAt: droppedProgress.updatedAt,
          })
          .onConflictDoNothing()
          .run();
      }
      db.delete(playbackProgress).where(eq(playbackProgress.itemId, row.id)).run();
      db.delete(libraryItems).where(eq(libraryItems.id, row.id)).run();
      removed += 1;
    }
    log.debug('library.duplicate-row-removed', { absolute });
  }
  return removed;
}

/** Index (or refresh) exactly one file — used when a download completes. */
export async function indexSingleFile(absolutePath: string): Promise<LibraryItem | null> {
  const roots = getMediaRoots();
  const root = roots.find((r) => isWithinRoot(absolutePath, r));
  if (!root) return null;
  if (!fs.existsSync(absolutePath)) return null;

  const stat = await fsp.stat(absolutePath);
  const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
  const fileName = path.basename(absolutePath);
  const extension = path.extname(fileName).slice(1).toLowerCase();
  const { db } = getDb();
  const previous = db.select().from(libraryItems).all().find((r) => r.root === root && r.relativePath === relativePath);
  const classified = classifyRelativePath(relativePath);
  const probe = await probeLocalFile(absolutePath);
  const subtitles = await findSubtitles(path.dirname(absolutePath), fileName, root);

  const values = {
    id: previous?.id ?? idFor(root, relativePath),
    root,
    relativePath,
    fileName,
    kind: classified.kind,
    sizeBytes: stat.size,
    extension,
    modifiedAt: stat.mtime.toISOString(),
    title: classified.title || path.basename(fileName, path.extname(fileName)),
    year: classified.year ?? null,
    seasonNumber: classified.seasonNumber ?? null,
    episodeNumber: classified.episodeNumber ?? null,
    probeJson: JSON.stringify(probe),
    subtitlesJson: JSON.stringify(subtitles),
    missing: 0,
    addedAt: previous?.addedAt ?? new Date().toISOString(),
  };

  db.insert(libraryItems)
    .values(values)
    .onConflictDoUpdate({ target: libraryItems.id, set: values })
    .run();

  const row = db.select().from(libraryItems).all().find((r) => r.id === values.id);
  return row ? rowToItem(row) : null;
}

async function findSubtitles(dir: string, mediaFileName: string, root: string): Promise<SubtitleTrack[]> {
  const stem = path.basename(mediaFileName, path.extname(mediaFileName)).toLowerCase();
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const tracks: SubtitleTrack[] = [];
  for (const entry of entries) {
    const ext = path.extname(entry).slice(1).toLowerCase();
    if (!SUBTITLE_EXTENSIONS.has(ext)) continue;
    const entryStem = path.basename(entry, path.extname(entry)).toLowerCase();
    if (!entryStem.startsWith(stem)) continue;
    const languageMatch = /\.([a-z]{2,3})(-[a-z]{2,4})?$/i.exec(entryStem.slice(stem.length));
    const relative = path.relative(root, path.join(dir, entry)).split(path.sep).join('/');
    tracks.push({
      label: entry,
      language: languageMatch?.[1]?.toLowerCase() ?? 'und',
      url: `/api/library/subtitles?path=${encodeURIComponent(relative)}`,
    });
  }
  return tracks;
}

/* --------------------------------- queries -------------------------------- */

export interface LibraryQuery {
  q?: string;
  kind?: 'movie' | 'tv' | 'other' | 'all';
  sort?: 'recent' | 'title' | 'size';
  missing?: boolean;
}

export function listLibrary(query: LibraryQuery = {}): LibraryItem[] {
  const { db } = getDb();
  const rows = db.select().from(libraryItems).all();
  const progressRows = db.select().from(playbackProgress).all();
  const progressById = new Map(progressRows.map((p) => [p.itemId, p]));

  let items = rows.map((row) => rowToItem(row, progressById.get(row.id)));

  if (query.kind && query.kind !== 'all') items = items.filter((item) => item.kind === query.kind);
  if (query.missing !== undefined) items = items.filter((item) => Boolean(item.missing) === query.missing);
  if (query.q) {
    const needle = query.q.toLowerCase();
    items = items.filter(
      (item) =>
        item.title.toLowerCase().includes(needle) ||
        item.fileName.toLowerCase().includes(needle) ||
        item.relativePath.toLowerCase().includes(needle),
    );
  }

  const sort = query.sort ?? 'recent';
  items.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    if (sort === 'size') return b.sizeBytes - a.sizeBytes;
    return a.modifiedAt < b.modifiedAt ? 1 : -1;
  });
  return items;
}

export function libraryStats(): { items: number; bytes: number; missing: number } {
  const items = listLibrary();
  return {
    items: items.length,
    bytes: items.reduce((sum, item) => sum + item.sizeBytes, 0),
    missing: items.filter((i) => i.missing).length,
  };
}

export function getLibraryItem(id: string): LibraryItem {
  const { db } = getDb();
  const row = db.select().from(libraryItems).all().find((r) => r.id === id);
  if (!row) throw notFound('That file is not in the library index. Run a rescan.');
  const progress = db.select().from(playbackProgress).all().find((p) => p.itemId === id);
  return rowToItem(row, progress);
}

export function getLibraryItemByRelativePath(relativePath: string): LibraryItem {
  const rows = listLibrary();
  const item = rows.find((r) => r.relativePath === relativePath);
  if (!item) throw notFound('That file is not in the library index.');
  return item;
}

/** Resolve an item row to an absolute path, verified against the media roots. */
export function resolveLibraryFile(item: LibraryItem): string {
  const { db } = getDb();
  const row = db.select().from(libraryItems).all().find((r) => r.id === item.id);
  if (!row) throw notFound('Unknown library item.');
  const absolute = path.resolve(row.root, row.relativePath);
  if (!isWithinRoot(absolute, row.root)) throw new AppError('FORBIDDEN', 'That path escapes its media root.');
  if (!fs.existsSync(absolute)) throw new AppError('NOT_FOUND', 'That file is missing from disk. Rescan the library.');
  return absolute;
}

/* ------------------------------ progress --------------------------------- */

/**
 * Files in the local library that match a catalogue title.
 *
 * Matching is deliberate, not fuzzy: the normalised titles must agree on every
 * distinctive word, and when both sides state a year they must be within one
 * year of each other. A wrong "you already own this" is worse than no match — it
 * sends the user to play the wrong film.
 */
export function findLocalCopies(input: { title: string; year?: number; kind?: MediaKind }): LocalCopy[] {
  const target = normalizeTitle(input.title);
  if (!target) return [];

  // Missing files are included on purpose: an entry whose file vanished is still
  // the user's copy, and the Watch screen already explains how to recover it.
  const rows = listLibrary({});
  const scored: { copy: LocalCopy; score: number }[] = [];

  for (const item of rows) {
    // Agreement is required in both directions. One way is not enough: a query of
    // "Scan" is fully contained in a library file called "Scan Fixture", and those
    // are different works. Allowing at most one extra word on the library side
    // keeps "Extended Cut" and similar suffixes working.
    if (titleAgreement(input.title, item.title) < 1) continue;
    if (titleAgreement(item.title, input.title) < 0.6) continue;

    let score = 100;
    if (input.year && item.year) {
      const delta = Math.abs(input.year - item.year);
      if (delta > 1) continue; // same words, different film
      score += delta === 0 ? 20 : 10;
    } else {
      // A year we cannot compare is worth less than a confirmed one.
      score -= 5;
    }
    if (input.kind && item.kind !== 'other' && item.kind !== input.kind) continue;
    if (item.missing) score -= 30;
    if (item.inProgress) score += 5;

    scored.push({
      score,
      copy: {
        id: item.id,
        relativePath: item.relativePath,
        fileName: item.fileName,
        sizeBytes: item.sizeBytes,
        title: item.title,
        year: item.year,
        seasonNumber: item.seasonNumber,
        episodeNumber: item.episodeNumber,
        inProgress: item.inProgress,
        missing: item.missing,
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || b.copy.sizeBytes - a.copy.sizeBytes)
    .slice(0, 8)
    .map((entry) => entry.copy);
}

export function getProgress(itemId: string): PlaybackProgress | null {
  const { db } = getDb();
  const row = db.select().from(playbackProgress).all().find((p) => p.itemId === itemId);
  if (!row) return null;
  return {
    itemId: row.itemId,
    positionSeconds: row.positionSeconds,
    durationSeconds: row.durationSeconds ?? undefined,
    completed: row.completed === 1,
    updatedAt: row.updatedAt,
  };
}

export function saveProgress(input: { itemId: string; positionSeconds: number; durationSeconds?: number; completed?: boolean }): PlaybackProgress {
  getLibraryItem(input.itemId); // 404s for unknown ids instead of silently writing
  const { db } = getDb();
  const values = {
    itemId: input.itemId,
    positionSeconds: input.positionSeconds,
    durationSeconds: input.durationSeconds ?? null,
    completed: input.completed ? 1 : 0,
    updatedAt: new Date().toISOString(),
  };
  db.insert(playbackProgress)
    .values(values)
    .onConflictDoUpdate({ target: playbackProgress.itemId, set: values })
    .run();
  return {
    itemId: input.itemId,
    positionSeconds: values.positionSeconds,
    durationSeconds: values.durationSeconds ?? undefined,
    completed: Boolean(values.completed),
    updatedAt: values.updatedAt,
  };
}

/* ------------------------------ subtitles -------------------------------- */

/** Convert SubRip to WebVTT in memory (browsers only take VTT). */
export function srtToVtt(input: string): string {
  const body = input
    .replace(/\r+/g, '')
    .replace(/^\uFEFF/, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body}`;
}

export async function readSubtitle(relativePath: string): Promise<{ body: string; mimeType: string }> {
  const roots = getMediaRoots();
  const absolute = roots.map((root) => path.resolve(root, relativePath)).find((candidate) => {
    const root = roots.find((r) => isWithinRoot(candidate, r));
    return Boolean(root) && fs.existsSync(candidate);
  });
  if (!absolute) throw notFound('That subtitle file is not in an approved media root.');
  const ext = path.extname(absolute).slice(1).toLowerCase();
  const text = await fsp.readFile(absolute, 'utf8');
  if (ext === 'srt') return { body: srtToVtt(text), mimeType: 'text/vtt' };
  if (ext === 'vtt') return { body: text, mimeType: 'text/vtt' };
  if (ext === 'ass' || ext === 'ssa') {
    return {
      body: `WEBVTT\n\nNOTE\nAdvanced SubStation Alpha subtitles (${path.basename(absolute)}) cannot be rendered as WebVTT without conversion. Install ffmpeg and use your external player, or convert the file to .vtt.`,
      mimeType: 'text/vtt',
    };
  }
  throw new AppError('UNSUPPORTED_MEDIA', 'That subtitle format is not supported.');
}

/* --------------------------- diagnostics --------------------------------- */

export interface StorageDiagnostic {
  root: string;
  exists: boolean;
  writable: boolean;
  itemCount: number;
  bytes: number;
  error?: string;
}

export function storageDiagnostics(): StorageDiagnostic[] {
  const items = listLibrary();
  return getMediaRoots().map((root) => {
    let exists = false;
    let writable = false;
    let error: string | undefined;
    try {
      exists = fs.existsSync(root);
      if (exists) fs.accessSync(root, fs.constants.W_OK);
      writable = exists;
    } catch (err) {
      error = (err as NodeJS.ErrnoException).code ?? 'unavailable';
    }
    const scoped = items.filter((item) => {
      const { db } = getDb();
      const row = db.select().from(libraryItems).all().find((r) => r.id === item.id);
      return row?.root === root;
    });
    return {
      root,
      exists,
      writable,
      itemCount: scoped.length,
      bytes: scoped.reduce((sum, i) => sum + i.sizeBytes, 0),
      error,
    };
  });
}

import { eq } from 'drizzle-orm';
function eqPath(relativeKey: string) {
  // The unique index is (root, relative_path); updates by id are simpler, so we
  // resolve the id first.
  const [root, relativePath] = relativeKey.split('::');
  const { db } = getDb();
  const row = db
    .select()
    .from(libraryItems)
    .all()
    .find((r) => r.root === root && r.relativePath === relativePath);
  return eq(libraryItems.id, row?.id ?? '');
}
