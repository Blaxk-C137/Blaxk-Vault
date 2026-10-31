/**
 * BlaxkVault server entry point.
 *
 * Boot order matters: config → database → access control → manager (with
 * restart reconciliation) → routes → realtime hub → static client. Errors
 * thrown during boot are fatal and printed with a fix suggestion rather than
 * leaving a half-initialised server running.
 */
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { config, loadedEnvKeys, REPO_ROOT } from './config.js';
import { initLogFormat, log, setLogLevel } from './logger.js';
import { AppError, badRequest, toAppError } from './lib/errors.js';
import { closeDatabase, initDatabase } from './db/index.js';
import { initAccessControl, makeAuthHook } from './security/auth.js';
import { ensureDir } from './security/paths.js';
import { DownloadManager } from './engine/manager.js';
import { hasFfmpeg, hasFfprobe } from './engine/probe.js';
import { indexSingleFile, libraryStats, scanLibrary } from './services/library.js';
import { getEffectiveDownloadSettings, getSettings } from './services/settings.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerDiscoveryRoutes } from './routes/discovery.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerDownloadRoutes } from './routes/downloads.js';
import { registerLibraryRoutes } from './routes/library.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { RealtimeHub } from './ws.js';

/** Compact, log-safe description of an unexpected error. */
function formatUnknown(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === 'string' ? error : JSON.stringify(error);
}

async function main(): Promise<void> {
  initLogFormat(config.env);
  setLogLevel(config.logLevel);

  // ---- storage bootstrap (download dir must exist before anything writes) --
  const download = getEffectiveDownloadSettings();
  ensureDir(download.directory);
  log.debug('Media directory ready', { directory: download.directory });

  // ---- database -----------------------------------------------------------
  initDatabase();

  // ---- access control -----------------------------------------------------
  initAccessControl();

  // ---- download manager ---------------------------------------------------
  const manager = new DownloadManager(
    { maxConcurrent: download.maxConcurrent, bandwidthLimitKbps: download.bandwidthLimitKbps, maxBytes: download.maxBytes },
    {
      onCompleted: async (job) => {
        // Post-processing happens outside the request path (§10). It probes the
        // finished file and indexes it, which is exactly the "real" work the
        // library screen depends on.
        await indexSingleFile(job.absolutePath).catch((err) =>
          log.warn('library.index-after-download-failed', { file: job.relativePath, message: (err as Error).message }),
        );
      },
    },
  );
  await manager.init();

  // ---- http ---------------------------------------------------------------
  const app = Fastify({
    logger: false, // we use our own structured logger
    trustProxy: false,
    bodyLimit: 512 * 1024,
  });

  // Fastify's default JSON parser treats an empty body with a JSON content type
  // as malformed. Action endpoints (pause/resume/cancel/retry, DELETE) legitimately
  // carry no payload, and `curl -X POST -H 'Content-Type: application/json'` is
  // how people test them, so an empty body means "no body" here.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const raw = typeof body === 'string' ? body.trim() : '';
    if (raw.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      const error = badRequest('The request body is not valid JSON.');
      done(error as never, undefined);
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    // Everything is same-origin: the UI is served by this server, talks to this
    // server's API, and plays media from this server's stream endpoint. Only
    // poster/CDN images and inline styles need an allowance. Framing is closed
    // unless BLAXKVAULT_FRAME_ANCESTORS says otherwise.
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        "img-src 'self' data: blob: https://image.tmdb.org https://archive.org",
        "media-src 'self' blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self' ws: wss:",
        `frame-ancestors ${config.frameAncestors}`,
      ].join('; '),
    );
  });

  app.addHook('onRequest', makeAuthHook(['/api/health']));

  app.setErrorHandler((error, request, reply) => {
    const appError = error instanceof AppError ? error : toAppError(error);
    if (appError.statusCode >= 500) {
      // Unknown failures are logged with their original error so the cause is
      // never swallowed into a generic "unexpected server error".
      log.error('request.failed', {
        method: request.method,
        url: request.url,
        code: appError.code,
        message: appError.message,
        cause: error instanceof AppError ? undefined : formatUnknown(error),
        stack: error instanceof AppError ? undefined : (error instanceof Error ? error.stack : undefined),
      });
    } else {
      log.warn('request.rejected', { method: request.method, url: request.url, code: appError.code, message: appError.message });
    }
    reply.code(appError.statusCode).send(appError.toBody());
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: `No API route matches ${request.method} ${request.url.split('?')[0]}.` } });
      return;
    }
    const indexHtml = path.join(REPO_ROOT, 'apps/web/dist/index.html');
    if (fs.existsSync(indexHtml)) {
      reply.type('text/html').send(fs.readFileSync(indexHtml));
      return;
    }
    reply.code(404).type('text/plain').send('BlaxkVault API is running, but the web client has not been built yet. Run: npm run build');
  });

  // ---- realtime -----------------------------------------------------------
  await app.register(fastifyWebsocket);
  const hub = new RealtimeHub(manager);

  const statsProvider = () => {
    const lib = libraryStats();
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
      libraryItems: lib.items,
      libraryBytes: lib.bytes,
      disk: settings.disk,
    };
  };
  hub.attach(app, statsProvider);

  // ---- routes -------------------------------------------------------------
  await registerHealthRoutes(app);
  await registerDiscoveryRoutes(app);
  await registerSourceRoutes(app);
  await registerDownloadRoutes(app, manager);
  await registerLibraryRoutes(app, {
    onScan: (result) => hub.broadcast({ type: 'library.updated', at: new Date().toISOString(), result }),
  });
  await registerSettingsRoutes(app, manager);

  // ---- static client (production build) -----------------------------------
  const webDist = path.join(REPO_ROOT, 'apps/web/dist');
  if (fs.existsSync(webDist)) {
    // wildcard: false registers exact routes for the built assets; the SPA
    // fallback in setNotFoundHandler serves index.html for client-side routes.
    await app.register(fastifyStatic, { root: webDist, wildcard: false, index: ['index.html'] });
    log.debug('Serving built web client', { path: webDist });
  } else {
    // One actionable line, not a warning: the API works fine without the bundle.
    log.info('Web client not built — run "npm run dev:web" for the hot-reload UI, or "npm run build" for a bundle to serve here.');
  }

  // ---- listen -------------------------------------------------------------
  await app.listen({ host: config.host, port: config.port });

  const settings = getSettings();
  const library = libraryStats();
  const tools = [hasFfprobe() ? 'ffprobe' : null, hasFfmpeg() ? 'ffmpeg' : null].filter(Boolean);
  log.info('BlaxkVault ready', {
    url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
    mode: config.env,
    catalogue: config.tmdb.apiKey ? 'TMDB live' : 'sample (no TMDB_API_KEY)',
    engine: config.download.engine,
    tools: tools.length > 0 ? tools.join(',') : 'none (sizes only)',
    library: `${library.items} file${library.items === 1 ? '' : 's'}`,
    media: settings.downloadDir,
  });
  log.debug('Startup detail', {
    mediaRoots: settings.mediaRoots,
    database: config.databasePath,
    logLevel: config.logLevel,
    logFormat: process.env.LOG_FORMAT ?? 'auto',
    envFile: loadedEnvKeys.length > 0 ? `.env (${loadedEnvKeys.length} keys)` : 'none',
  });

  // ---- graceful shutdown --------------------------------------------------
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down', { signal });
    hub.close();
    await manager.shutdown(); // pauses active transfers, keeps .part files, flushes state
    await app.close();
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('unhandledRejection', { message: reason instanceof Error ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (error) => {
    log.fatal('uncaughtException', { message: error.message, stack: error.stack?.split('\n')[1]?.trim() });
  });

  // Kick off a first library scan in the background so the Library screen is
  // populated on first run without blocking the HTTP server (§10).
  if (config.env !== 'test') {
    setTimeout(() => {
      void scanLibrary().catch((err) => log.warn('library.initial-scan-failed', { message: (err as Error).message }));
    }, 750);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\nBlaxkVault failed to start: ${message}\n`);
  if (/Invalid BlaxkVault configuration/.test(message)) {
    process.stderr.write('Fix the values in .env (see .env.example) and start again.\n');
  }
  if (/EADDRINUSE/.test(message)) {
    process.stderr.write(`Port ${config.port} is already in use. Change PORT in .env or stop the other process.\n`);
  }
  if (/ENOTFOUND|EADDRNOTAVAIL|EINVAL/.test(message) && /listen|getaddrinfo/i.test(message)) {
    process.stderr.write(
      `HOST is set to "${config.host}", which cannot be used as a listening address.\n` +
        'Use 127.0.0.1 (this machine only) or 0.0.0.0 (all interfaces) in .env, with no comment on the same line.\n',
    );
  }
  process.exit(1);
});
