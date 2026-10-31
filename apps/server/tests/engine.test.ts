/**
 * Download engine tests — run against a real local HTTP fixture server, so the
 * worker exercises actual sockets, real range requests, real disk writes and
 * real partial-file resume. Nothing here is mocked.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerEvent } from '@blaxkvault/shared';
import { TEST_ROOT } from './setup.js';
// setup.ts runs before this module is imported, so configuration is already in place.
import { initDatabase, closeDatabase, getDb } from '../src/db/index.js';
import { jobs as jobsTable } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { DownloadManager } from '../src/engine/manager.js';
import { inspectDirectUrl } from '../src/engine/inspect.js';

const MP4_HEADER = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, // ....ftypmp42
  0x00, 0x00, 0x00, 0x00, 0x6d, 0x70, 0x34, 0x32, 0x69, 0x73, 0x6f, 0x6d, // ....mp42isom
]);

function makeBody(size: number, seed = 7): Buffer {
  const body = Buffer.alloc(size);
  MP4_HEADER.copy(body, 0);
  for (let i = MP4_HEADER.length; i < size; i += 1) body[i] = (i * seed) % 251;
  return body;
}

let server: http.Server;
let baseUrl = '';

const FIXTURE_SIZE = 512 * 1024;
const SLOW_SIZE = 2 * 1024 * 1024;

beforeAll(async () => {
  const fast = makeBody(FIXTURE_SIZE);

  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const range = req.headers.range;

    const sendRange = (body: Buffer, contentType: string, honourRange = true) => {
      res.setHeader('Content-Type', contentType);
      if (honourRange) res.setHeader('Accept-Ranges', 'bytes');
      if (range && honourRange) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        const start = match?.[1] ? Number.parseInt(match[1], 10) : 0;
        const end = match?.[2] ? Math.min(Number.parseInt(match[2], 10), body.length - 1) : body.length - 1;
        if (start >= body.length) {
          res.statusCode = 416;
          res.setHeader('Content-Range', `bytes */${body.length}`);
          res.end();
          return;
        }
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
        res.setHeader('Content-Length', String(end - start + 1));
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.setHeader('Content-Length', String(body.length));
      res.end(body);
    };

    switch (url.pathname) {
      case '/file.mp4':
        return sendRange(fast, 'video/mp4');
      case '/no-range.mp4':
        return sendRange(fast, 'video/mp4', false);
      case '/page.html':
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.end('<!doctype html><html><body><h1>Watch this film</h1></body></html>');
      case '/playlist.m3u8':
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.end('#EXTM3U\n#EXT-X-VERSION:3\n');
      case '/missing.mp4':
        res.statusCode = 404;
        return res.end('not here');
      case '/slow.mp4': {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', String(SLOW_SIZE));
        res.writeHead(200);
        let sent = 0;
        const chunk = makeBody(32 * 1024);
        const timer = setInterval(() => {
          if (sent >= SLOW_SIZE) {
            clearInterval(timer);
            res.end();
            return;
          }
          const take = Math.min(chunk.length, SLOW_SIZE - sent);
          res.write(chunk.subarray(0, take));
          sent += take;
        }, 40);
        res.on('close', () => clearInterval(timer));
        return;
      }
      default:
        res.statusCode = 404;
        return res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'object' && address) baseUrl = `http://127.0.0.1:${address.port}`;

  initDatabase();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  closeDatabase();
});

async function waitFor(predicate: () => boolean, timeoutMs = 20_000, label = 'condition'): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe('inspectDirectUrl', () => {
  it('accepts a real mp4 and reports true size, range support and playability', async () => {
    const result = await inspectDirectUrl(`${baseUrl}/file.mp4`, { title: 'Fixture' });
    expect(result.status).toBe('available');
    expect(result.sizeBytes).toBe(FIXTURE_SIZE);
    expect(result.acceptRanges).toBe(true);
    expect(result.probe.container).toBe('mp4');
    expect(result.probe.browserPlayable).toBe(true);
    expect(result.fileUrl).toBe(`${baseUrl}/file.mp4`);
  });

  it('refuses an HTML page with a human explanation', async () => {
    const result = await inspectDirectUrl(`${baseUrl}/page.html`, {});
    expect(result.status).toBe('unsupported');
    expect(result.reason).toMatch(/HTML web page/i);
    expect(result.fileUrl).toBeUndefined();
  });

  it('refuses a streaming playlist', async () => {
    const result = await inspectDirectUrl(`${baseUrl}/playlist.m3u8`, {});
    expect(result.status).toBe('unsupported');
    expect(result.reason).toMatch(/playlist/i);
  });

  it('flags a server that cannot resume', async () => {
    const result = await inspectDirectUrl(`${baseUrl}/no-range.mp4`, {});
    expect(result.status).toBe('available');
    expect(result.acceptRanges).toBe(false);
    expect((result.probe.notes ?? []).join(' ')).toMatch(/does not advertise byte-range/i);
  });
});

describe('DownloadManager', () => {
  it('downloads a file end to end with real progress', async () => {
    const manager = new DownloadManager({ maxConcurrent: 2, bandwidthLimitKbps: 0, maxBytes: 0 });
    await manager.init();
    const events: ServerEvent[] = [];
    manager.on('event', (event: ServerEvent) => events.push(event));

    const job = manager.create({
      fileUrl: `${baseUrl}/file.mp4`,
      sourcePageUrl: 'https://example.org/fixture',
      rightsNote: 'Test fixture',
      ref: { title: 'Fixture Film', year: 1999, kind: 'movie' },
    });
    manager.enqueue(job.id);
    await waitFor(() => manager.get(job.id).status === 'completed', 20_000, 'completion');

    const finished = manager.get(job.id);
    expect(finished.bytesDownloaded).toBe(FIXTURE_SIZE);
    expect(finished.progress).toBe(1);
    expect(finished.relativePath).toBe('Movies/Fixture Film (1999)/file.mp4');
    expect(fs.existsSync(finished.absolutePath)).toBe(true);
    expect(fs.statSync(finished.absolutePath).size).toBe(FIXTURE_SIZE);
    // The partial file must be gone after a clean success.
    expect(fs.existsSync(`${finished.absolutePath}.part`)).toBe(false);
    // Progress events must reflect genuine byte counts.
    const progressEvents = events.filter((e) => e.type === 'job.updated' && e.job.status === 'downloading');
    expect(progressEvents.length).toBeGreaterThan(0);
    await manager.shutdown();
  });

  it('pauses a live transfer, keeps the partial file, then resumes to completion', async () => {
    const manager = new DownloadManager({ maxConcurrent: 2, bandwidthLimitKbps: 0, maxBytes: 0 });
    await manager.init();

    const job = manager.create({
      fileUrl: `${baseUrl}/slow.mp4`,
      sourcePageUrl: 'https://example.org/slow',
      ref: { title: 'Slow Fixture', kind: 'movie' },
    });
    manager.enqueue(job.id);
    await waitFor(() => manager.get(job.id).bytesDownloaded > 0, 20_000, 'first bytes');

    await manager.pause(job.id);
    await waitFor(() => manager.get(job.id).status === 'paused', 10_000, 'pause');
    const paused = manager.get(job.id);
    const partPath = `${paused.absolutePath}.part`;
    expect(fs.existsSync(partPath)).toBe(true);
    const partialSize = fs.statSync(partPath).size;
    expect(partialSize).toBeGreaterThan(0);
    expect(partialSize).toBeLessThan(SLOW_SIZE);

    // Nothing should keep growing while paused.
    await new Promise((r) => setTimeout(r, 400));
    expect(fs.statSync(partPath).size).toBe(partialSize);

    await manager.resume(job.id);
    await waitFor(() => manager.get(job.id).status === 'completed', 30_000, 'resume completion');
    expect(fs.statSync(manager.get(job.id).absolutePath).size).toBe(SLOW_SIZE);
    await manager.shutdown();
  });

  it('cancels a transfer and removes the partial file', async () => {
    const manager = new DownloadManager({ maxConcurrent: 2, bandwidthLimitKbps: 0, maxBytes: 0 });
    await manager.init();
    const job = manager.create({ fileUrl: `${baseUrl}/slow.mp4`, sourcePageUrl: 'https://example.org/slow', ref: { title: 'Cancel Fixture' } });
    manager.enqueue(job.id);
    await waitFor(() => manager.get(job.id).bytesDownloaded > 0, 20_000, 'first bytes');

    await manager.cancel(job.id);
    await new Promise((r) => setTimeout(r, 300));
    const cancelled = manager.get(job.id);
    expect(cancelled.status).toBe('cancelled');
    expect(fs.existsSync(cancelled.absolutePath)).toBe(false);
    expect(fs.existsSync(`${cancelled.absolutePath}.part`)).toBe(false);
    await manager.shutdown();
  });

  it('records a real failure with a usable reason instead of faking success', async () => {
    const manager = new DownloadManager({ maxConcurrent: 2, bandwidthLimitKbps: 0, maxBytes: 0 });
    await manager.init();
    const job = manager.create({ fileUrl: `${baseUrl}/missing.mp4`, sourcePageUrl: 'https://example.org/gone', ref: { title: 'Gone Fixture' } });
    manager.enqueue(job.id);
    await waitFor(() => manager.get(job.id).status === 'failed', 20_000, 'failure');
    const failed = manager.get(job.id);
    expect(failed.errorCode).toBe('NOT_FOUND');
    expect(failed.error).toMatch(/404|no longer/i);
    expect(fs.existsSync(failed.absolutePath)).toBe(false);

    // Retry on a repaired URL succeeds.
    const retried = manager.create({ fileUrl: `${baseUrl}/file.mp4`, sourcePageUrl: 'https://example.org/fixture', ref: { title: 'Retry Fixture' } });
    manager.enqueue(retried.id);
    await waitFor(() => manager.get(retried.id).status === 'completed', 20_000, 'retry completion');
    await manager.shutdown();
  });

  it('enforces concurrency and honours a raised limit live', async () => {
    const manager = new DownloadManager({ maxConcurrent: 1, bandwidthLimitKbps: 0, maxBytes: 0 });
    await manager.init();
    const ids = [1, 2, 3].map((n) =>
      manager.create({ fileUrl: `${baseUrl}/slow.mp4`, sourcePageUrl: 'https://example.org/slow', ref: { title: `Concurrent Fixture ${n}` } }).id,
    );
    for (const id of ids) manager.enqueue(id);

    await waitFor(() => manager.list().some((j) => j.status === 'downloading'), 10_000, 'first download starts');
    await new Promise((r) => setTimeout(r, 300));
    expect(manager.list().filter((j) => j.status === 'downloading').length).toBe(1);

    manager.setLimits({ maxConcurrent: 3 });
    await waitFor(() => manager.list().filter((j) => j.status === 'downloading').length === 3, 10_000, 'all three running');

    for (const id of ids) await manager.cancel(id);
    await manager.shutdown();
  });

  it('reconciles an interrupted download on restart', async () => {
    const first = new DownloadManager({ maxConcurrent: 2, bandwidthLimitKbps: 0, maxBytes: 0 });
    await first.init();
    const job = first.create({ fileUrl: `${baseUrl}/slow.mp4`, sourcePageUrl: 'https://example.org/slow', ref: { title: 'Interrupted Fixture' } });
    first.enqueue(job.id);
    await waitFor(() => first.get(job.id).bytesDownloaded > 0, 20_000, 'first bytes');
    await first.shutdown(); // graceful stop: pauses the job and keeps the .part file

    // Simulate a hard crash: the row still claims "downloading" on the next boot.
    const absolutePath = first.get(job.id).absolutePath;
    const partPath = `${absolutePath}.part`;
    const { db } = getDb();
    db.update(jobsTable).set({ status: 'downloading' }).where(eq(jobsTable.id, job.id)).run();
    const partSize = fs.statSync(partPath).size;
    expect(partSize).toBeGreaterThan(0);

    const revived = new DownloadManager({ maxConcurrent: 2, bandwidthLimitKbps: 0, maxBytes: 0 });
    await revived.init();
    const revivedJob = revived.get(job.id);
    expect(revivedJob.status).toBe('paused');
    expect(revivedJob.bytesDownloaded).toBe(partSize);
    expect(revivedJob.error).toMatch(/restart/i);
    expect(revivedJob.errorCode).toBe('RESTART_INTERRUPTED');

    // And it can genuinely finish from there.
    await revived.resume(job.id);
    await waitFor(() => revived.get(job.id).status === 'completed', 30_000, 'reconciled completion');
    expect(fs.statSync(absolutePath).size).toBe(SLOW_SIZE);
    await revived.shutdown();
  });

  it('never deletes media when only removing history', async () => {
    const manager = new DownloadManager({ maxConcurrent: 2, bandwidthLimitKbps: 0, maxBytes: 0 });
    await manager.init();
    const job = manager.create({ fileUrl: `${baseUrl}/file.mp4`, sourcePageUrl: 'https://example.org/fixture', ref: { title: 'History Fixture' } });
    manager.enqueue(job.id);
    await waitFor(() => manager.get(job.id).status === 'completed', 20_000, 'completion');
    const absolutePath = manager.get(job.id).absolutePath;

    manager.remove(job.id);
    expect(fs.existsSync(absolutePath)).toBe(true);

    // Explicit deletion is a separate, confirmed action.
    const second = manager.create({ fileUrl: `${baseUrl}/file.mp4`, sourcePageUrl: 'https://example.org/fixture', ref: { title: 'Delete Fixture' } });
    manager.enqueue(second.id);
    await waitFor(() => manager.get(second.id).status === 'completed', 20_000, 'completion 2');
    const secondPath = manager.get(second.id).absolutePath;
    await expect(manager.deleteFile(second.id, false)).rejects.toThrow(/confirmation/i);
    await manager.deleteFile(second.id, true);
    expect(fs.existsSync(secondPath)).toBe(false);
    await manager.shutdown();
  });

  it('enforces the configured size cap', async () => {
    const manager = new DownloadManager({ maxConcurrent: 1, bandwidthLimitKbps: 0, maxBytes: 1024 });
    await manager.init();
    const job = manager.create({ fileUrl: `${baseUrl}/file.mp4`, sourcePageUrl: 'https://example.org/fixture', ref: { title: 'Capped Fixture' } });
    manager.enqueue(job.id);
    await waitFor(() => ['failed', 'completed'].includes(manager.get(job.id).status), 20_000, 'cap outcome');
    const capped = manager.get(job.id);
    expect(capped.status).toBe('failed');
    expect(capped.errorCode).toBe('TOO_LARGE');
    expect(fs.existsSync(capped.absolutePath)).toBe(false);
    await manager.shutdown();
  });
});
