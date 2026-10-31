/**
 * Native download worker.
 *
 * The blueprint lists aria2 as the intended engine. aria2 is not installed on
 * every host — including the machine this was built and tested on — so the
 * shipped default is a native Node worker that implements the same job
 * semantics: real progress, real pause/resume via HTTP range requests, real
 * speed/ETA, bandwidth throttling, idle timeouts and hard size caps. The aria2
 * adapter (engine/aria2.ts) remains available when DOWNLOAD_ENGINE=aria2.
 *
 * Truthfulness rules baked in:
 *   - Progress is only reported from bytes actually written to disk.
 *   - `bytesTotal` stays undefined when the server never states a length, and
 *     the UI shows "unknown" rather than a fake percentage.
 *   - A pause is not a failure and a failure is not a pause.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { log } from '../logger.js';
import { assertSafeRemoteUrl } from '../security/url-guard.js';

export interface DownloadProgress {
  bytesDownloaded: number;
  bytesTotal?: number;
  speedBps: number;
  etaSeconds?: number;
}

export type DownloadOutcome = 'completed' | 'paused' | 'cancelled' | 'failed';

export interface NativeDownloadCallbacks {
  onProgress(progress: DownloadProgress): void;
  onOutcome(outcome: DownloadOutcome, detail?: { message: string; code: string }): void;
}

export interface NativeDownloadOptions {
  url: string;
  /** Final path; the worker writes to `partPath` and renames on success. */
  targetPath: string;
  partPath: string;
  resumeFrom: number;
  acceptRanges: boolean;
  maxBytes: number;
  bandwidthLimitKbps: number;
  idleTimeoutMs: number;
  connectTimeoutMs: number;
  maxRedirects: number;
  callbacks: NativeDownloadCallbacks;
}

interface Controlled {
  abort: (kind: 'pause' | 'cancel') => void;
}

const active = new Map<string, Controlled>();

export function abortJob(jobId: string, kind: 'pause' | 'cancel'): boolean {
  const controller = active.get(jobId);
  if (!controller) return false;
  controller.abort(kind);
  return true;
}

export async function downloadFile(jobId: string, options: NativeDownloadOptions): Promise<void> {
  const {
    url,
    targetPath,
    partPath,
    resumeFrom,
    acceptRanges,
    maxBytes,
    bandwidthLimitKbps,
    idleTimeoutMs,
    connectTimeoutMs,
    maxRedirects,
    callbacks,
  } = options;

  let settleKind: 'pause' | 'cancel' | null = null;
  let finished = false;
  let bytesTotal: number | undefined;
  let written = resumeFrom;
  let request: http.ClientRequest | null = null;
  let response: IncomingMessage | null = null;
  let fileHandle: fsp.FileHandle | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let writeChain: Promise<void> = Promise.resolve();

  const controller: Controlled = {
    abort: (kind) => {
      settleKind = kind;
      if (idleTimer) clearTimeout(idleTimer);
      try {
        response?.destroy();
      } catch {
        /* already closed */
      }
      try {
        request?.destroy();
      } catch {
        /* already closed */
      }
    },
  };
  active.set(jobId, controller);

  const finish = (outcome: DownloadOutcome, detail?: { message: string; code: string }) => {
    if (finished) return;
    finished = true;
    if (idleTimer) clearTimeout(idleTimer);
    active.delete(jobId);
    callbacks.onOutcome(outcome, detail);
  };

  const fail = (code: string, message: string) => finish('failed', { code, message });

  try {
    // ---- redirect-safe request -------------------------------------------
    let currentUrl = url;
    let hops = 0;
    let res: IncomingMessage | null = null;

    while (hops <= maxRedirects) {
      await assertSafeRemoteUrl(currentUrl);
      res = await requestHeadOrGet(jobId, currentUrl, resumeFrom, acceptRanges, connectTimeoutMs, (r) => {
        request = r;
      });
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        const next = new URL(res.headers.location, currentUrl).toString();
        res.resume(); // drain
        currentUrl = next;
        hops += 1;
        continue;
      }
      break;
    }

    if (!res) return fail('UPSTREAM_ERROR', 'No response from the remote server.');
    response = res;
    const status = res.statusCode ?? 0;

    if (settleKind) {
      res.resume();
      return finish(settleKind === 'pause' ? 'paused' : 'cancelled');
    }

    if (status === 416) {
      // Requested range not satisfiable → the partial file is probably complete.
      const size = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0;
      if (size > 0) {
        await fsp.rename(partPath, targetPath).catch(() => undefined);
        return finish('completed');
      }
      return fail('RANGE_UNSUPPORTED', 'The server rejected the requested byte range and no partial file exists.');
    }

    if (status === 401 || status === 403) {
      res.resume();
      return fail('FORBIDDEN', `The remote server refused the request (HTTP ${status}). The link may need a signed token or may have expired.`);
    }
    if (status === 404) {
      res.resume();
      return fail('NOT_FOUND', 'The remote server returned 404 — the file is no longer at that URL.');
    }
    if (status === 429) {
      res.resume();
      return fail('RATE_LIMITED', 'The remote server is rate limiting this download (HTTP 429). Try again later.');
    }
    if (status >= 400) {
      res.resume();
      return fail('UPSTREAM_ERROR', `The remote server returned HTTP ${status}.`);
    }

    const contentLength = Number.parseInt(res.headers['content-length'] ?? '', 10);
    const contentRange = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(res.headers['content-range'] ?? '');
    const rangeHonoured = status === 206;

    if (resumeFrom > 0 && !rangeHonoured) {
      // Server ignored our Range header and started from zero: restart cleanly.
      log.warn('download.range-ignored', { jobId });
      written = 0;
      await fsp.rm(partPath, { force: true });
    }

    if (rangeHonoured && contentRange?.[3] && contentRange[3] !== '*') {
      bytesTotal = Number.parseInt(contentRange[3], 10);
      written = Number.parseInt(contentRange[1]!, 10);
    } else if (Number.isFinite(contentLength)) {
      bytesTotal = rangeHonoured ? undefined : contentLength;
      if (!rangeHonoured) written = 0;
    } else {
      bytesTotal = undefined; // chunked / unknown length — say so, never guess
    }

    if (maxBytes > 0 && bytesTotal !== undefined && bytesTotal > maxBytes) {
      res.resume();
      return fail('TOO_LARGE', `The file is larger than the configured download cap (${maxBytes} bytes).`);
    }

    // ---- open the partial file -------------------------------------------
    await fsp.mkdir(path.dirname(partPath), { recursive: true });
    if (written > 0) fileHandle = await fsp.open(partPath, 'r+');
    else fileHandle = await fsp.open(partPath, 'w');

    // ---- speed + ETA sampling --------------------------------------------
    const samples: { t: number; bytes: number }[] = [{ t: Date.now(), bytes: written }];
    let lastEmit = 0;
    let lastPersist = 0;
    let bytesSinceWindow = 0;

    const computeSpeed = (): number => {
      const now = Date.now();
      while (samples.length > 1 && now - samples[0]!.t > 6000) samples.shift();
      const first = samples[0]!;
      const seconds = Math.max(0.25, (now - first.t) / 1000);
      return Math.max(0, (written - first.bytes) / seconds);
    };

    const emitProgress = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 400) return;
      lastEmit = now;
      const speedBps = computeSpeed();
      const etaSeconds = bytesTotal !== undefined && speedBps > 0 ? Math.max(0, (bytesTotal - written) / speedBps) : undefined;
      callbacks.onProgress({ bytesDownloaded: written, bytesTotal, speedBps, etaSeconds });
    };

    // ---- throttling (token bucket) ---------------------------------------
    const bytesPerSecondCap = bandwidthLimitKbps > 0 ? (bandwidthLimitKbps * 1024) / 8 : 0;
    let windowStart = Date.now();
    let windowBytes = 0;

    const throttleIfNeeded = async (): Promise<void> => {
      if (bytesPerSecondCap <= 0) return;
      const elapsed = (Date.now() - windowStart) / 1000;
      if (elapsed >= 1) {
        windowStart = Date.now();
        windowBytes = 0;
        return;
      }
      const allowance = bytesPerSecondCap * elapsed;
      if (windowBytes > allowance) {
        const waitMs = Math.min(1000, ((windowBytes - allowance) / bytesPerSecondCap) * 1000);
        res!.pause();
        await new Promise((r) => setTimeout(r, waitMs));
        res!.resume();
      }
    };

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail('TIMEOUT', `No data arrived for ${Math.round(idleTimeoutMs / 1000)} seconds, so the transfer was stopped.`);
        controller.abort('cancel');
      }, idleTimeoutMs);
    };
    resetIdleTimer();

    // ---- stream to disk ---------------------------------------------------
    await new Promise<void>((resolve, reject) => {
      res!.on('data', (chunk: Buffer) => {
        resetIdleTimer();
        bytesSinceWindow += chunk.length;
        windowBytes += chunk.length;
        const position = written;
        written += chunk.length;
        samples.push({ t: Date.now(), bytes: written });

        res!.pause();
        writeChain = writeChain
          .then(async () => {
            await fileHandle!.write(chunk, 0, chunk.length, position);
            if (maxBytes > 0 && written > maxBytes) {
              throw Object.assign(new Error('size cap exceeded'), { __code: 'TOO_LARGE' });
            }
            if (bytesTotal !== undefined && written >= bytesTotal) {
              emitProgress(true);
            } else {
              emitProgress();
            }
            await throttleIfNeeded();
          })
          .then(() => {
            if (settleKind) return;
            res!.resume();
          })
          .catch(reject);
      });

      res!.on('end', () => resolve());
      res!.on('error', reject);
      res!.on('close', () => resolve());
    });

    await writeChain;

    if (settleKind) {
      await fileHandle.close().catch(() => undefined);
      if (settleKind === 'cancel') {
        // A cancel must leave nothing behind: the partial file is removed here
        // too, not only on the exception path.
        await fsp.rm(partPath, { force: true }).catch(() => undefined);
      }
      return finish(settleKind === 'pause' ? 'paused' : 'cancelled');
    }

    await fileHandle.close();
    fileHandle = null;

    if (bytesTotal !== undefined && written < bytesTotal) {
      const missing = bytesTotal - written;
      if (!acceptRanges) {
        return fail(
          'UPSTREAM_ERROR',
          `The connection closed ${missing} bytes early and the server does not support resuming, so the file is incomplete.`,
        );
      }
      return fail('UPSTREAM_ERROR', `The connection closed ${missing} bytes early. The partial file was kept — retry to resume from here.`);
    }

    const stat = await fsp.stat(partPath);
    if (stat.size === 0) return fail('UPSTREAM_ERROR', 'The download produced an empty file.');

    await fsp.rename(partPath, targetPath);
    emitProgress(true);
    finish('completed');
  } catch (err) {
    const error = err as NodeJS.ErrnoException & { __code?: string };
    active.delete(jobId);
    if (settleKind) {
      await fileHandle?.close().catch(() => undefined);
      if (settleKind === 'cancel') await fsp.rm(partPath, { force: true }).catch(() => undefined);
      return finish(settleKind === 'pause' ? 'paused' : 'cancelled');
    }
    if (error.__code === 'TOO_LARGE') {
      await fileHandle?.close().catch(() => undefined);
      await fsp.rm(partPath, { force: true }).catch(() => undefined);
      return fail('TOO_LARGE', `The download exceeded the configured cap of ${maxBytes} bytes and was removed.`);
    }
    await fileHandle?.close().catch(() => undefined);
    if (error.code === 'ENOSPC') {
      return fail('DISK_FULL', 'The disk filled up during the transfer. Free space and retry — the partial file was kept.');
    }
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return fail('UPSTREAM_ERROR', 'DNS resolution failed for the media host. Check connectivity and retry.');
    }
    if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return fail('UPSTREAM_ERROR', `The connection failed (${error.code}). The partial file was kept if any bytes arrived.`);
    }
    log.error('download.unexpected', { jobId, message: error.message });
    return fail('INTERNAL', 'The download stopped because of an unexpected error.');
  } finally {
    active.delete(jobId);
    if (idleTimer) clearTimeout(idleTimer);
  }
}

/** Issue the request, translating RequestOptions into a promise. */
function requestHeadOrGet(
  jobId: string,
  url: string,
  resumeFrom: number,
  acceptRanges: boolean,
  timeoutMs: number,
  onRequest: (req: http.ClientRequest) => void,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const headers: Record<string, string> = {
      'User-Agent': 'BlaxkVault/1.0 (personal media manager)',
      Accept: '*/*',
      'Accept-Encoding': 'identity', // byte offsets must stay exact
    };
    if (resumeFrom > 0 && acceptRanges) headers.Range = `bytes=${resumeFrom}-`;

    const req = client.request(
      parsed,
      {
        method: 'GET',
        headers,
        timeout: timeoutMs,
      },
      (res) => {
        res.setTimeout(0);
        resolve(res);
      },
    );
    onRequest(req);
    req.on('timeout', () => {
      req.destroy(new Error(`Connection to ${parsed.host} timed out after ${timeoutMs} ms.`));
    });
    req.on('error', (err) => {
      log.debug('download.request-error', { jobId, message: err.message });
      reject(Object.assign(err, { code: (err as NodeJS.ErrnoException).code ?? 'ECONNRESET' }));
    });
    req.end();
  });
}

/** Used by the manager to decide whether a restart should resume or restart. */
export async function partialSize(partPath: string): Promise<number> {
  try {
    const stat = await fsp.stat(partPath);
    return stat.size;
  } catch {
    return 0;
  }
}
