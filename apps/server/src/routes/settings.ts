/**
 * Settings + system stats.
 *
 * PATCH applies safely: paths are validated to sit inside an approved media
 * root, the aria2 RPC URL must stay on loopback, and numeric limits are bounded.
 * Side effects (queue concurrency, bandwidth) are pushed into the live manager
 * so a change takes effect without a restart.
 */
import type { FastifyInstance } from 'fastify';
import type { SystemStats } from '@blaxkvault/shared';
import { settingsPatchSchema } from '@blaxkvault/shared';
import { AppError } from '../lib/errors.js';
import { getSettings, patchSettings } from '../services/settings.js';
import { libraryStats, storageDiagnostics } from '../services/library.js';
import { diskUsage } from '../services/settings.js';
import type { DownloadManager } from '../engine/manager.js';

export async function registerSettingsRoutes(app: FastifyInstance, manager: DownloadManager): Promise<void> {
  app.get('/api/settings', async () => ({ settings: getSettings(), storage: storageDiagnostics() }));

  app.patch('/api/settings', async (request) => {
    const parsed = settingsPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Some settings values are invalid.', parsed.error.flatten());
    }
    const result = patchSettings(parsed.data);
    manager.setLimits({
      maxConcurrent: result.settings.maxConcurrentDownloads,
      bandwidthLimitKbps: result.settings.bandwidthLimitKbps,
      maxBytes: result.settings.maxDownloadBytes,
    });
    return result;
  });

  app.get('/api/stats', async (): Promise<SystemStats> => {
    const library = libraryStats();
    const downloadStats = manager.stats();
    const settings = getSettings();
    return {
      queued: downloadStats.queued,
      active: downloadStats.active,
      completed: downloadStats.completed,
      failed: downloadStats.failed,
      totalSpeedBps: downloadStats.totalSpeedBps,
      bytesDownloadedToday: manager
        .list()
        .filter((job) => job.status === 'completed' && job.completedAt?.slice(0, 10) === new Date().toISOString().slice(0, 10))
        .reduce((sum, job) => sum + job.bytesDownloaded, 0),
      libraryItems: library.items,
      libraryBytes: library.bytes,
      disk: diskUsage(settings.downloadDir),
    };
  });
}
