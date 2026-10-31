/**
 * Download queue manager.
 *
 * Responsibilities (blueprint §5.4):
 *   - own the job state machine: inspected → queued → downloading → completed,
 *     with paused / failed / cancelled / unsupported / unavailable branches;
 *   - enforce concurrency and bandwidth limits;
 *   - persist every transition to SQLite and reconcile on restart against what
 *     is actually on disk / in the engine;
 *   - emit real progress events (bytes written, speed, ETA) — never fake ones.
 *
 * "Remove from history" deletes the record only. Deleting a media file is a
 * separate, explicit, confirmed action (blueprint §9).
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CreateDownloadInput, DownloadJob, DownloadStatus, ServerEvent } from '@blaxkvault/shared';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { jobs as jobsTable } from '../db/schema.js';
import { log } from '../logger.js';
import { AppError, conflict, notFound } from '../lib/errors.js';
import {
  buildRelativeMediaPath,
  ensureDir,
  relativeToMediaRoots,
  resolveWithinRoot,
  sanitizeFileName,
  uniqueFilePath,
} from '../security/paths.js';
import { downloadFile, abortJob, partialSize } from './native-downloader.js';
import { aria2Add, aria2Available, aria2Controls, aria2ErrorExplanation, aria2StatusMany } from './aria2.js';

export interface ManagerLimits {
  maxConcurrent: number;
  bandwidthLimitKbps: number;
  maxBytes: number;
}

export interface ManagerHooks {
  onCompleted?: (job: DownloadJob) => Promise<void> | void;
}

type JobRow = typeof jobsTable.$inferSelect;

function nowIso(): string {
  return new Date().toISOString();
}

export class DownloadManager extends EventEmitter {
  private jobs = new Map<string, DownloadJob>();
  private running = new Set<string>();
  private limits: ManagerLimits;
  private hooks: ManagerHooks;
  private aria2PollTimer: NodeJS.Timeout | null = null;
  private persistTimers = new Map<string, NodeJS.Timeout>();
  private lastPersisted = new Map<string, number>();

  constructor(limits: ManagerLimits, hooks: ManagerHooks = {}) {
    super();
    this.limits = limits;
    this.hooks = hooks;
  }

  /* ------------------------------- lifecycle ---------------------------- */

  async init(): Promise<void> {
    const { db } = getDb();
    const rows = db.select().from(jobsTable).all();
    for (const row of rows) this.jobs.set(row.id, this.rowToJob(row));
    await this.reconcile(rows);
    this.setMaxListeners(50);
    this.emitEvent({ type: 'jobs.snapshot', at: nowIso(), jobs: this.list() });
    if (config.download.engine === 'aria2') {
      const available = await aria2Available();
      if (available) {
        this.startAria2Polling();
        log.debug('Download engine: aria2 (localhost JSON-RPC)');
      } else {
        log.warn('DOWNLOAD_ENGINE=aria2 but no aria2 RPC answered — using the native worker instead.');
      }
    } else {
      log.debug('Download engine: native');
    }
    this.pump();
  }

  /** Restart reconciliation: nothing is trusted, everything is verified. */
  private async reconcile(rows: JobRow[]): Promise<void> {
    for (const row of rows) {
      const job = this.jobs.get(row.id)!;
      const partPath = `${job.absolutePath}.part`;

      if (row.status === 'downloading' || row.status === 'queued') {
        const size = await partialSize(partPath);
        if (size > 0) {
          job.status = 'paused';
          job.bytesDownloaded = size;
          job.speedBps = 0;
          job.etaSeconds = undefined;
          job.error = 'Interrupted by a server restart. The partial file was found and the job is paused — resume to continue.';
          job.errorCode = 'RESTART_INTERRUPTED';
        } else {
          job.status = 'queued';
          job.bytesDownloaded = 0;
          job.error = undefined;
          job.errorCode = undefined;
        }
        this.persist(job, true);
        log.info('Reconciled interrupted job', { id: job.id, status: job.status, bytes: job.bytesDownloaded });
        continue;
      }

      if (row.status === 'completed') {
        if (!fs.existsSync(job.absolutePath)) {
          job.error = 'The engine reports this download as completed, but the file is missing from disk. Rescan the library or re-download.';
          job.errorCode = 'FILE_MISSING';
          this.persist(job, true);
        } else {
          const size = fs.statSync(job.absolutePath).size;
          if (size !== job.bytesDownloaded) {
            job.bytesDownloaded = size;
            job.bytesTotal = job.bytesTotal ?? size;
            job.progress = job.bytesTotal ? Math.min(1, size / job.bytesTotal) : 1;
            this.persist(job, true);
          }
        }
      }
    }
  }

  setLimits(limits: Partial<ManagerLimits>): void {
    this.limits = { ...this.limits, ...limits };
    this.pump();
  }

  getLimits(): ManagerLimits {
    return { ...this.limits };
  }

  /* --------------------------------- reads ------------------------------ */

  list(): DownloadJob[] {
    return [...this.jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  get(id: string): DownloadJob {
    const job = this.jobs.get(id);
    if (!job) throw notFound('That download is not in the queue.');
    return job;
  }

  /* -------------------------------- create ------------------------------ */

  create(input: CreateDownloadInput): DownloadJob {
    const relative = buildRelativeMediaPath({
      kind: input.ref?.kind,
      title: input.ref?.title ?? 'Untitled',
      year: input.ref?.year,
      seasonNumber: input.ref?.seasonNumber,
      episodeNumber: input.ref?.episodeNumber,
      // Prefer a real filename from the URL: archive.org and most file hosts put
      // a meaningful name there, and it keeps the library self-explanatory.
      fileName: input.fileName ?? fileNameFromUrl(input.fileUrl) ?? input.ref?.title ?? 'download',
      extension: extensionOfUrl(input.fileUrl) || 'mp4',
    });

    const absolute = resolveWithinRoot(config.download.directory, relative);
    ensureDir(path.dirname(absolute));
    const finalPath = uniqueFilePath(absolute);
    const finalRelative = relativeToMediaRoots(finalPath);

    const job: DownloadJob = {
      id: randomUUID(),
      status: 'inspected',
      engine: config.download.engine === 'aria2' ? 'aria2' : 'native',
      sourceId: input.sourceId ?? 'direct-url',
      sourcePageUrl: input.sourcePageUrl,
      fileUrl: input.fileUrl,
      fileName: path.basename(finalPath),
      relativePath: finalRelative,
      absolutePath: finalPath,
      bytesTotal: input.bytesTotal,
      bytesDownloaded: 0,
      speedBps: 0,
      etaSeconds: undefined,
      progress: 0,
      rightsNote: input.rightsNote,
      ref: input.ref ?? {},
      attempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.jobs.set(job.id, job);
    this.persist(job, true);
    this.emitJob(job);
    return job;
  }

  /* -------------------------------- actions ----------------------------- */

  enqueue(id: string): DownloadJob {
    const job = this.get(id);
    if (!['inspected', 'paused', 'failed', 'queued'].includes(job.status)) {
      throw conflict(`A ${job.status} download cannot be queued again.`);
    }
    job.status = 'queued';
    job.error = undefined;
    job.errorCode = undefined;
    job.updatedAt = nowIso();
    this.persist(job, true);
    this.emitJob(job);
    this.pump();
    return job;
  }

  async pause(id: string): Promise<DownloadJob> {
    const job = this.get(id);
    if (job.status === 'queued') {
      job.status = 'paused';
      job.updatedAt = nowIso();
      this.persist(job, true);
      this.emitJob(job);
      return job;
    }
    if (job.status !== 'downloading') throw conflict(`Only a queued or downloading job can be paused (this one is ${job.status}).`);
    if (job.engine === 'aria2') {
      await aria2Controls.pause(job.id);
    } else {
      abortJob(id, 'pause');
    }
    // The worker reports the final outcome; we update optimistically for responsiveness.
    job.status = 'paused';
    job.speedBps = 0;
    job.etaSeconds = undefined;
    job.updatedAt = nowIso();
    this.persist(job, true);
    this.emitJob(job);
    return job;
  }

  async resume(id: string): Promise<DownloadJob> {
    const job = this.get(id);
    if (!['paused', 'failed'].includes(job.status)) throw conflict(`Only a paused or failed job can be resumed (this one is ${job.status}).`);
    job.status = 'queued';
    job.error = undefined;
    job.errorCode = undefined;
    job.updatedAt = nowIso();
    this.persist(job, true);
    this.emitJob(job);
    this.pump();
    return job;
  }

  async cancel(id: string): Promise<DownloadJob> {
    const job = this.get(id);
    if (job.status === 'downloading') {
      if (job.engine === 'aria2') {
        await aria2Controls.forceRemove(job.id);
      } else {
        const aborted = abortJob(id, 'cancel');
        // Race guard: the worker may have finished between the status read and
        // the abort. A complete file on disk must never be reported as cancelled.
        if (!aborted && fs.existsSync(job.absolutePath)) {
          const size = fs.statSync(job.absolutePath).size;
          this.running.delete(id);
          job.status = 'completed';
          job.bytesDownloaded = size;
          job.bytesTotal = job.bytesTotal ?? size;
          job.progress = job.bytesTotal > 0 ? Math.min(1, size / job.bytesTotal) : 1;
          job.speedBps = 0;
          job.etaSeconds = undefined;
          job.completedAt = nowIso();
          job.error = undefined;
          job.errorCode = undefined;
          job.updatedAt = nowIso();
          this.persist(job, true);
          this.emitJob(job);
          return job;
        }
      }
    }
    job.status = 'cancelled';
    job.speedBps = 0;
    job.etaSeconds = undefined;
    job.error = 'Cancelled by you. Any partial file was removed.';
    job.errorCode = 'CANCELLED';
    job.updatedAt = nowIso();
    this.running.delete(id);
    this.persist(job, true);
    this.emitJob(job);
    return job;
  }

  retry(id: string): DownloadJob {
    const job = this.get(id);
    if (['downloading', 'queued'].includes(job.status)) throw conflict('That download is already running.');
    job.attempts += 1;
    job.status = 'queued';
    job.error = undefined;
    job.errorCode = undefined;
    job.updatedAt = nowIso();
    this.persist(job, true);
    this.emitJob(job);
    this.pump();
    return job;
  }

  /** Remove from history only. The downloaded file is never touched here (§9). */
  remove(id: string): void {
    const job = this.get(id);
    if (job.status === 'downloading') throw conflict('Pause or cancel the download before removing it from the queue.');
    this.jobs.delete(id);
    const { db } = getDb();
    db.delete(jobsTable).where(eqId(id)).run();
    this.emitEvent({ type: 'job.removed', at: nowIso(), jobId: id });
  }

  /** Explicit, confirmed deletion of a stored file (never implied by remove()). */
  async deleteFile(id: string, confirm: boolean): Promise<{ deleted: boolean; path: string }> {
    if (!confirm) throw new AppError('BAD_REQUEST', 'Deleting a media file requires explicit confirmation.');
    const job = this.get(id);
    if (job.status === 'downloading') throw conflict('Cannot delete a file that is still downloading.');
    const resolved = resolveWithinRoot(config.download.directory, job.relativePath);
    if (fs.existsSync(resolved)) await fsp.rm(resolved, { force: true });
    job.error = 'The stored file was deleted at your request.';
    job.errorCode = 'FILE_DELETED';
    job.updatedAt = nowIso();
    this.persist(job, true);
    this.emitJob(job);
    return { deleted: true, path: job.relativePath };
  }

  /* --------------------------------- pump -------------------------------- */

  private pump(): void {
    const capacity = Math.max(0, this.limits.maxConcurrent - this.running.size);
    if (capacity <= 0) return;
    const waiting = this.list()
      .filter((job) => job.status === 'queued')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
      .slice(0, capacity);
    for (const job of waiting) void this.run(job);
  }

  private async run(job: DownloadJob): Promise<void> {
    if (this.running.has(job.id)) return;
    this.running.add(job.id);

    job.status = 'downloading';
    job.startedAt = job.startedAt ?? nowIso();
    job.error = undefined;
    job.errorCode = undefined;
    job.attempts += 1;
    job.updatedAt = nowIso();
    this.persist(job, true);
    this.emitJob(job);

    const useAria2 = config.download.engine === 'aria2' && job.engine === 'aria2' && (await aria2Available());
    if (useAria2) {
      try {
        const dir = path.dirname(job.absolutePath);
        const { gid } = await aria2Add({
          url: job.fileUrl,
          dir,
          fileName: path.basename(job.absolutePath),
          paused: false,
          maxBytes: this.limits.maxBytes,
          bandwidthLimitKbps: this.limits.bandwidthLimitKbps,
        });
        job.fileName = gid; // temporary carrier; the poller writes real progress
        job.engine = 'aria2';
        this.persist(job, true);
      } catch (err) {
        job.error = `aria2 could not accept the job (${(err as Error).message}). It will be retried with the native worker.`;
        job.errorCode = 'ENGINE_FALLBACK';
        job.engine = 'native';
        this.persist(job, true);
        this.emitJob(job);
        await this.runNative(job);
      }
      return;
    }
    await this.runNative(job);
  }

  private async runNative(job: DownloadJob): Promise<void> {
    const partPath = `${job.absolutePath}.part`;
    const existing = await partialSize(partPath);
    const resumeFrom = existing > 0 ? existing : 0;

    if (job.bytesTotal !== undefined && resumeFrom > job.bytesTotal) {
      // A stale partial from a different size: start over rather than corrupt.
      await fsp.rm(partPath, { force: true });
    }

    job.bytesDownloaded = resumeFrom;
    job.speedBps = 0;
    job.updatedAt = nowIso();
    this.emitJob(job);

    await downloadFile(job.id, {
      url: job.fileUrl,
      targetPath: job.absolutePath,
      partPath,
      resumeFrom,
      acceptRanges: true,
      maxBytes: this.limits.maxBytes,
      bandwidthLimitKbps: this.limits.bandwidthLimitKbps,
      idleTimeoutMs: config.download.idleTimeoutMs,
      connectTimeoutMs: config.download.connectTimeoutMs,
      maxRedirects: config.download.maxRedirects,
      callbacks: {
        onProgress: (progress) => {
          // Guard: a paused/cancelled job must not be resurrected by a late event.
          if (!this.running.has(job.id)) return;
          job.bytesDownloaded = progress.bytesDownloaded;
          job.bytesTotal = progress.bytesTotal ?? job.bytesTotal;
          job.speedBps = Math.round(progress.speedBps);
          job.etaSeconds = progress.etaSeconds !== undefined ? Math.round(progress.etaSeconds) : undefined;
          job.progress = job.bytesTotal && job.bytesTotal > 0 ? Math.min(1, job.bytesDownloaded / job.bytesTotal) : 0;
          job.updatedAt = nowIso();
          this.emitJob(job);
          this.persist(job);
        },
        onOutcome: (outcome, detail) => {
          this.running.delete(job.id);
          job.updatedAt = nowIso();
          if (outcome === 'completed') {
            const stat = fs.existsSync(job.absolutePath) ? fs.statSync(job.absolutePath) : null;
            const size = stat?.size ?? job.bytesDownloaded;
            job.bytesDownloaded = size;
            job.bytesTotal = job.bytesTotal ?? size;
            job.progress = job.bytesTotal > 0 ? Math.min(1, size / job.bytesTotal) : 1;
            job.speedBps = 0;
            job.etaSeconds = undefined;
            job.status = 'completed';
            job.completedAt = nowIso();
            job.error = undefined;
            job.errorCode = undefined;
            this.persist(job, true);
            this.emitJob(job);
            log.info('Download completed', { id: job.id, file: job.relativePath, bytes: size });
            void Promise.resolve(this.hooks.onCompleted?.(job)).catch((err) =>
              log.warn('download.complete-hook-failed', { message: (err as Error).message }),
            );
          } else if (outcome === 'paused') {
            job.status = 'paused';
            job.speedBps = 0;
            job.etaSeconds = undefined;
            job.error = undefined;
            job.errorCode = undefined;
            this.persist(job, true);
            this.emitJob(job);
          } else if (outcome === 'cancelled') {
            job.status = 'cancelled';
            job.speedBps = 0;
            job.etaSeconds = undefined;
            job.error = 'Cancelled. The partial file was removed.';
            job.errorCode = 'CANCELLED';
            job.updatedAt = nowIso();
            // Defence in depth: whatever the worker did, a cancelled job must not
            // leave a .part file behind for the library scan to trip over.
            void fsp.rm(`${job.absolutePath}.part`, { force: true }).catch(() => undefined);
            this.persist(job, true);
            this.emitJob(job);
          } else {
            job.status = 'failed';
            job.speedBps = 0;
            job.etaSeconds = undefined;
            job.error = detail?.message ?? 'The download failed.';
            job.errorCode = detail?.code ?? 'UNKNOWN';
            this.persist(job, true);
            this.emitJob(job);
            this.emitEvent({ type: 'notice', at: nowIso(), level: 'error', message: `${job.fileName}: ${job.error}` });
          }
          this.pump();
        },
      },
    });
  }

  /* ------------------------------- aria2 poll --------------------------- */

  private startAria2Polling(): void {
    if (this.aria2PollTimer) return;
    this.aria2PollTimer = setInterval(() => {
      const gids = this.list()
        .filter((j) => j.engine === 'aria2' && j.status === 'downloading')
        .map((j) => j.fileName);
      if (gids.length === 0) return;
      void aria2StatusMany(gids).then((statuses) => {
        for (const status of statuses) {
          const job = this.list().find((j) => j.fileName === status.gid && j.status === 'downloading');
          if (!job) continue;
          const total = Number.parseInt(status.totalLength, 10) || undefined;
          const done = Number.parseInt(status.completedLength, 10) || 0;
          job.bytesDownloaded = done;
          job.bytesTotal = total;
          job.speedBps = Number.parseInt(status.downloadSpeed, 10) || 0;
          job.etaSeconds = total && job.speedBps > 0 ? Math.round((total - done) / job.speedBps) : undefined;
          job.progress = total && total > 0 ? Math.min(1, done / total) : 0;
          job.updatedAt = nowIso();

          if (status.status === 'complete') {
            job.status = 'completed';
            job.completedAt = nowIso();
            this.running.delete(job.id);
            this.persist(job, true);
            this.emitJob(job);
            void Promise.resolve(this.hooks.onCompleted?.(job)).catch(() => undefined);
            this.pump();
          } else if (status.status === 'error') {
            job.status = 'failed';
            job.error = `${aria2ErrorExplanation(status.errorCode)}${status.errorMessage ? ` ${status.errorMessage}` : ''}`;
            job.errorCode = `ARIA2_${status.errorCode ?? 'UNKNOWN'}`;
            this.running.delete(job.id);
            this.persist(job, true);
            this.emitJob(job);
            this.pump();
          } else if (status.status === 'paused') {
            job.status = 'paused';
            job.speedBps = 0;
            this.running.delete(job.id);
            this.persist(job, true);
            this.emitJob(job);
            this.pump();
          } else {
            this.persist(job);
            this.emitJob(job);
          }
        }
      });
    }, 3000);
    this.aria2PollTimer.unref?.();
  }

  /* ------------------------------ persistence ---------------------------- */

  private rowToJob(row: JobRow): DownloadJob {
    let ref: DownloadJob['ref'] = {};
    try {
      ref = JSON.parse(row.refJson) as DownloadJob['ref'];
    } catch {
      ref = {};
    }
    return {
      id: row.id,
      status: row.status as DownloadStatus,
      engine: row.engine as 'native' | 'aria2',
      sourceId: row.sourceId,
      sourcePageUrl: row.sourcePageUrl,
      fileUrl: row.fileUrl,
      fileName: row.fileName,
      relativePath: row.relativePath,
      absolutePath: row.absolutePath,
      bytesTotal: row.bytesTotal ?? undefined,
      bytesDownloaded: row.bytesDownloaded,
      speedBps: row.speedBps,
      etaSeconds: row.etaSeconds ?? undefined,
      progress: row.bytesTotal && row.bytesTotal > 0 ? Math.min(1, row.bytesDownloaded / row.bytesTotal) : row.status === 'completed' ? 1 : 0,
      rightsNote: row.rightsNote ?? undefined,
      ref,
      error: row.error ?? undefined,
      errorCode: row.errorCode ?? undefined,
      attempts: row.attempts,
      createdAt: row.createdAt,
      startedAt: row.startedAt ?? undefined,
      completedAt: row.completedAt ?? undefined,
      updatedAt: row.updatedAt,
    };
  }

  private persist(job: DownloadJob, immediate = false): void {
    const run = () => {
      const { db } = getDb();
      const values = {
        id: job.id,
        status: job.status,
        engine: job.engine,
        sourceId: job.sourceId,
        sourcePageUrl: job.sourcePageUrl,
        fileUrl: job.fileUrl,
        fileName: job.fileName,
        relativePath: job.relativePath,
        absolutePath: job.absolutePath,
        bytesTotal: job.bytesTotal ?? null,
        bytesDownloaded: Math.round(job.bytesDownloaded),
        speedBps: Math.round(job.speedBps),
        etaSeconds: job.etaSeconds ?? null,
        rightsNote: job.rightsNote ?? null,
        refJson: JSON.stringify(job.ref ?? {}),
        error: job.error ?? null,
        errorCode: job.errorCode ?? null,
        attempts: job.attempts,
        createdAt: job.createdAt,
        startedAt: job.startedAt ?? null,
        completedAt: job.completedAt ?? null,
        updatedAt: job.updatedAt,
      };
      db.insert(jobsTable)
        .values(values)
        .onConflictDoUpdate({ target: jobsTable.id, set: values })
        .run();
      this.lastPersisted.set(job.id, Date.now());
    };

    if (immediate) {
      const pending = this.persistTimers.get(job.id);
      if (pending) clearTimeout(pending);
      this.persistTimers.delete(job.id);
      run();
      return;
    }
    // Progress writes are throttled to at most one DB write per 2s per job (§10).
    const last = this.lastPersisted.get(job.id) ?? 0;
    if (Date.now() - last > 2000) {
      run();
      return;
    }
    if (this.persistTimers.has(job.id)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(job.id);
      run();
    }, 2000);
    timer.unref?.();
    this.persistTimers.set(job.id, timer);
  }

  private emitJob(job: DownloadJob): void {
    this.emitEvent({ type: 'job.updated', at: nowIso(), job: { ...job } });
  }

  private emitEvent(event: ServerEvent): void {
    this.emit('event', event);
  }

  stats(): { queued: number; active: number; completed: number; failed: number; totalSpeedBps: number } {
    const all = this.list();
    return {
      queued: all.filter((j) => j.status === 'queued').length,
      active: all.filter((j) => j.status === 'downloading').length,
      completed: all.filter((j) => j.status === 'completed').length,
      failed: all.filter((j) => j.status === 'failed').length,
      totalSpeedBps: all.reduce((sum, j) => sum + (j.status === 'downloading' ? j.speedBps : 0), 0),
    };
  }

  async shutdown(): Promise<void> {
    if (this.aria2PollTimer) clearInterval(this.aria2PollTimer);
    for (const id of [...this.running]) abortJob(id, 'pause');
    // Give writers a moment to flush the final bytes and persist.
    await new Promise((resolve) => setTimeout(resolve, 350));
    for (const job of this.list()) this.persist(job, true);
  }
}

function fileNameFromUrl(url: string): string | undefined {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    if (!base || !/\.[a-z0-9]{2,5}$/i.test(base)) return undefined;
    return base;
  } catch {
    return undefined;
  }
}

function extensionOfUrl(url: string): string {
  const clean = url.split('?')[0] ?? '';
  const last = clean.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  return dot > 0 ? sanitizeFileName(last.slice(dot + 1)) : '';
}

/* Drizzle helper kept local so the manager owns its own query shape. */
import { eq } from 'drizzle-orm';
function eqId(id: string) {
  return eq(jobsTable.id, id);
}
