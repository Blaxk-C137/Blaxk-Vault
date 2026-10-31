/**
 * Offline library + playback API.
 *
 * The stream endpoint implements HTTP range requests properly (206 +
 * Content-Range), which is what makes seeking work in a browser video element
 * without any transcoding. Files are served only from indexed library items, so
 * the path is always resolved against a stored, verified root rather than a
 * client-supplied string.
 */
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { libraryQuerySchema, progressPatchSchema } from '@blaxkvault/shared';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import {
  getLibraryItem,
  getLibraryItemByRelativePath,
  getProgress,
  libraryStats,
  listLibrary,
  readSubtitle,
  resolveLibraryFile,
  saveProgress,
  scanLibrary,
  storageDiagnostics,
} from '../services/library.js';
import type { FastifyReply } from 'fastify';

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
  avi: 'video/x-msvideo',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mp2t',
  m2ts: 'video/mp2t',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
};

export async function registerLibraryRoutes(
  app: FastifyInstance,
  hooks: { onScan?: (result: Awaited<ReturnType<typeof scanLibrary>>) => void },
): Promise<void> {
  app.get('/api/library', async (request) => {
    const parsed = libraryQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Those library filters are not valid.');
    const items = listLibrary(parsed.data);
    return { items, stats: libraryStats(), roots: storageDiagnostics().map((d) => ({ root: d.root, exists: d.exists, writable: d.writable })) };
  });

  app.get('/api/library/stats', async () => ({ stats: libraryStats(), storage: storageDiagnostics() }));

  app.post('/api/library/scan', async () => {
    const result = await scanLibrary();
    hooks.onScan?.(result);
    return { result, stats: libraryStats() };
  });

  app.get<{ Params: { id: string } }>('/api/library/items/:id', async (request) => {
    const item = getLibraryItem(request.params.id);
    return { item, progress: getProgress(item.id) };
  });

  app.patch<{ Params: { id: string } }>('/api/library/items/:id/progress', async (request) => {
    const parsed = progressPatchSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Progress needs a numeric position.');
    return { progress: saveProgress({ itemId: request.params.id, ...parsed.data }) };
  });

  app.get('/api/library/subtitles', async (request, reply) => {
    const relativePath = (request.query as { path?: string }).path;
    if (!relativePath) throw badRequest('A subtitle path is required.');
    const { body, mimeType } = await readSubtitle(relativePath);
    reply.header('Content-Type', `${mimeType}; charset=utf-8`);
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(body);
  });

  /**
   * GET /api/library/stream?id=…  (or ?path=…)
   * Range-aware media serving from the approved roots.
   */
  app.get('/api/library/stream', async (request, reply: FastifyReply) => {
    const query = request.query as { id?: string; path?: string };
    const item = query.id ? getLibraryItem(query.id) : query.path ? getLibraryItemByRelativePath(query.path) : null;
    if (!item) throw badRequest('Provide the library item id or its relative path.');
    if (item.missing) throw notFound('That file is missing from disk. Rescan the library and try again.');

    const absolute = resolveLibraryFile(item);
    const stat = await fsp.stat(absolute);
    const mime = MIME_BY_EXTENSION[item.extension] ?? 'application/octet-stream';
    const rangeHeader = request.headers.range;

    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', mime);
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Content-Disposition', `inline; filename="${encodeURIComponent(item.fileName)}"`);

    if (item.probe && !item.probe.browserPlayable) {
      // Still serve the file — the client may hand it to an external player — but
      // tell the truth in a header the UI can surface.
      reply.header('X-Blaxkvault-Playback', 'external-recommended');
    }

    if (!rangeHeader) {
      reply.header('Content-Length', String(stat.size));
      return reply.send(createReadStream(absolute));
    }

    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (!match) {
      reply.code(416).header('Content-Range', `bytes */${stat.size}`);
      return reply.send({ error: { code: 'RANGE_UNSUPPORTED', message: 'Malformed Range header.' } });
    }

    const startRaw = match[1];
    const endRaw = match[2];
    let start: number;
    let end: number;
    if (!startRaw && endRaw) {
      // suffix range: last N bytes
      const suffix = Number.parseInt(endRaw, 10);
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    } else {
      start = Number.parseInt(startRaw ?? '0', 10);
      end = endRaw ? Number.parseInt(endRaw, 10) : stat.size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      reply.code(416).header('Content-Range', `bytes */${stat.size}`);
      return reply.send({ error: { code: 'RANGE_UNSUPPORTED', message: 'Requested range is outside the file.' } });
    }
    end = Math.min(end, stat.size - 1);

    reply.code(206);
    reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    reply.header('Content-Length', String(end - start + 1));
    return reply.send(createReadStream(absolute, { start, end }));
  });
}
