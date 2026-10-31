/**
 * GET /api/health — the only unauthenticated endpoint.
 *
 * It reveals capability flags (is a TMDB key configured?) but never a secret, a
 * path, or a token. The frontend uses it to render honest "live vs sample
 * catalogue" and "tools detected" states instead of guessing.
 */
import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '@blaxkvault/shared';
import { config } from '../config.js';
import { accessControlMode } from '../security/auth.js';
import { getDb } from '../db/index.js';
import { hasFfmpeg, hasFfprobe } from '../engine/probe.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    let database = false;
    try {
      getDb().raw.prepare('SELECT 1').get();
      database = true;
    } catch {
      database = false;
    }
    return {
      status: database ? 'ok' : 'degraded',
      version: config.version,
      uptimeSeconds: Math.round(process.uptime()),
      clock: new Date().toISOString(),
      capabilities: {
        tmdb: Boolean(config.tmdb.apiKey),
        watchmode: Boolean(config.watchmode.apiKey),
        archive: true,
        aria2: config.download.engine === 'aria2',
        ffprobe: hasFfprobe(),
        ffmpeg: hasFfmpeg(),
        database,
      },
      mode: config.tmdb.apiKey ? 'live' : 'fixture',
      accessControl: accessControlMode(),
    };
  });
}
