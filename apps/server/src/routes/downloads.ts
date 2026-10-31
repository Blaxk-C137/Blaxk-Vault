/**
 * Download queue API (blueprint §8).
 *
 * Every mutation goes through the manager, which persists state and emits a
 * realtime event. `DELETE /api/downloads/:id` removes history only; deleting the
 * stored file is a separate endpoint that requires an explicit confirmation
 * flag, so a UI slip can never destroy media (§9).
 */
import type { FastifyInstance } from 'fastify';
import { createDownloadSchema } from '@blaxkvault/shared';
import { AppError } from '../lib/errors.js';
import type { DownloadManager } from '../engine/manager.js';

export async function registerDownloadRoutes(app: FastifyInstance, manager: DownloadManager): Promise<void> {
  app.get('/api/downloads', async (request) => {
    const status = (request.query as { status?: string }).status;
    const jobs = manager.list();
    return {
      jobs: status ? jobs.filter((job) => job.status === status) : jobs,
      limits: manager.getLimits(),
      stats: manager.stats(),
    };
  });

  /**
   * Queue a download. The URL must already have been inspected and must be a
   * verified direct media resource: the route re-checks the URL is not internal
   * (the worker re-validates again before every hop) and refuses obvious
   * non-media URLs so a queued job cannot be a stealth page fetch.
   */
  app.post('/api/downloads', async (request, reply) => {
    const parsed = createDownloadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'A download needs a direct file URL and the page it came from.', parsed.error.flatten());
    }
    const job = manager.create(parsed.data);
    manager.enqueue(job.id);
    reply.code(201);
    return { job: manager.get(job.id) };
  });

  app.get<{ Params: { id: string } }>('/api/downloads/:id', async (request) => ({ job: manager.get(request.params.id) }));

  app.post<{ Params: { id: string } }>('/api/downloads/:id/pause', async (request) => ({ job: await manager.pause(request.params.id) }));
  app.post<{ Params: { id: string } }>('/api/downloads/:id/resume', async (request) => ({ job: await manager.resume(request.params.id) }));
  app.post<{ Params: { id: string } }>('/api/downloads/:id/cancel', async (request) => ({ job: await manager.cancel(request.params.id) }));
  app.post<{ Params: { id: string } }>('/api/downloads/:id/retry', async (request) => ({ job: manager.retry(request.params.id) }));

  /** Remove from history. The file stays on disk — stated plainly in the response. */
  app.delete<{ Params: { id: string } }>('/api/downloads/:id', async (request) => {
    manager.remove(request.params.id);
    return { removed: true, fileKept: true, message: 'Removed from the download queue. The downloaded file was not deleted.' };
  });

  /** Explicit file deletion, requires confirm=true. */
  app.delete<{ Params: { id: string }; Querystring: { confirm?: string; file?: string } }>('/api/downloads/:id/file', async (request) => {
    const confirm = request.query.confirm === 'true';
    const result = await manager.deleteFile(request.params.id, confirm);
    return { ...result, message: 'The stored file was deleted.' };
  });
}
