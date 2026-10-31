/**
 * Configuration loading and validation.
 *
 * Every value is validated with Zod at boot; the process refuses to start on an
 * invalid configuration rather than failing later inside a request handler.
 * Secrets are read here and never leave the server process (blueprint §9).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from './lib/env-file.js';
import { z } from 'zod';
import { BLAXKVAULT_VERSION } from '@blaxkvault/shared';

/** Walk up from this file to the workspace root (the package.json with `workspaces`). */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return dir;
      } catch {
        /* ignore malformed package.json and keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

export const REPO_ROOT = findRepoRoot(path.resolve(import.meta.dirname ?? process.cwd(), '..'));

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v)));

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int().min(min).max(max));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().optional(),
  PORT: int(3000, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // pretty = readable lines for a human; json = one object per line for a log
  // collector. Unset = decide from the environment (terminal vs piped).
  LOG_FORMAT: z.enum(['pretty', 'json']).optional(),
  DATABASE_URL: z.string().default('./data/blaxkvault.db'),
  BLAXKVAULT_ACCESS_TOKEN: z.string().optional(),
  /**
   * Explicit opt-out of authentication for a server that is only reachable
   * through a trusted local proxy (for example a sandbox preview URL).
   * Never enable this on a host that untrusted clients can reach.
   */
  BLAXKVAULT_ALLOW_UNAUTHENTICATED: bool(false),
  /**
   * Value for the CSP `frame-ancestors` directive. Defaults to 'self' (no
   * third-party framing). Set to a specific origin only when you deliberately
   * embed the UI, e.g. in a local dashboard shell.
   */
  BLAXKVAULT_FRAME_ANCESTORS: z.string().default("'self'"),

  TMDB_API_KEY: z.string().optional(),
  TMDB_REGION: z.string().length(2).default('NG'),
  TMDB_LANGUAGE: z.string().min(2).max(10).default('en-US'),
  TMDB_CACHE_TTL_SECONDS: int(3600, 0, 86_400),

  WATCHMODE_API_KEY: z.string().optional(),
  WATCHMODE_REGION: z.string().length(2).default('NG'),

  DOWNLOAD_ENGINE: z.enum(['native', 'aria2']).default('native'),
  ARIA2_RPC_URL: z.string().default('http://127.0.0.1:6800/jsonrpc'),
  ARIA2_RPC_SECRET: z.string().optional(),
  DOWNLOAD_DIR: z.string().default('./media/BlaxkVault-Media'),
  MAX_CONCURRENT_DOWNLOADS: int(2, 1, 8),
  MAX_DOWNLOAD_BYTES: int(0, 0),
  BANDWIDTH_LIMIT_KBPS: int(0, 0, 10_000_000),
  CONNECT_TIMEOUT_MS: int(15_000, 1000, 120_000),
  IDLE_TIMEOUT_MS: int(20_000, 2000, 300_000),
  MAX_REDIRECTS: int(5, 0, 10),

  FFPROBE_PATH: z.string().default('ffprobe'),
  FFMPEG_PATH: z.string().default('ffmpeg'),

  MEDIA_ROOTS: z.string().default(''),
  ALLOW_PRIVATE_ADDRESSES: bool(false),
  ALLOWED_HTTP_HOSTS: z.string().default(''),
});

export interface AppConfig {
  version: string;
  env: 'development' | 'production' | 'test';
  isProduction: boolean;
  host: string;
  port: number;
  logLevel: string;
  databasePath: string;
  accessToken: string | null;
  allowUnauthenticated: boolean;
  frameAncestors: string;
  tmdb: { apiKey: string | null; region: string; language: string; cacheTtlSeconds: number };
  watchmode: { apiKey: string | null; region: string };
  download: {
    engine: 'native' | 'aria2';
    aria2RpcUrl: string;
    aria2Secret: string | null;
    directory: string;
    maxConcurrent: number;
    maxBytes: number;
    bandwidthLimitKbps: number;
    connectTimeoutMs: number;
    idleTimeoutMs: number;
    maxRedirects: number;
  };
  tools: { ffprobePath: string; ffmpegPath: string };
  security: {
    mediaRoots: string[];
    allowPrivateAddresses: boolean;
    allowedHttpHosts: string[];
  };
}

function parseEnvFile(): void {
  const envPath = path.join(REPO_ROOT, '.env');
  // Inline comments, quotes and `export ` prefixes are handled by the shared
  // parser (see lib/env-file.ts) — copy .env.example verbatim and it works.
  const applied = loadEnvFile((file) => readFileSync(file, 'utf8'), envPath);
  if (applied.length > 0) loadedEnvKeys = applied;
}

/** Keys taken from .env (not from the real environment) — used by settings UI. */
export let loadedEnvKeys: string[] = [];

function absolutize(p: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(REPO_ROOT, p);
}

function loadConfig(): AppConfig {
  parseEnvFile();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid BlaxkVault configuration:\n${issues}`);
  }
  const env = parsed.data;

  const downloadDir = absolutize(env.DOWNLOAD_DIR);
  const declaredRoots = env.MEDIA_ROOTS.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(absolutize);
  // The download directory is always an approved root, otherwise the worker
  // could not legally write the files it is asked to fetch. When MEDIA_ROOTS is
  // empty the download directory is the only root, which keeps library paths
  // identical to the documented on-disk layout (Movies/<Title> (<Year>)/file).
  const mediaRoots = Array.from(new Set([...declaredRoots, downloadDir]));

  return {
    version: BLAXKVAULT_VERSION,
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    // Development defaults to loopback: `npm run dev` is a local tool, and the
    // Vite dev server already proxies to 127.0.0.1, so there is no reason to
    // expose the port to the LAN (or to require an access token) while coding.
    // Production keeps the container-friendly default; set HOST explicitly to
    // override either way.
    host: env.HOST?.trim() || (env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0'),
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    databasePath: absolutize(env.DATABASE_URL),
    accessToken: env.BLAXKVAULT_ACCESS_TOKEN?.trim() ? env.BLAXKVAULT_ACCESS_TOKEN.trim() : null,
    allowUnauthenticated: env.BLAXKVAULT_ALLOW_UNAUTHENTICATED,
    frameAncestors: env.BLAXKVAULT_FRAME_ANCESTORS,
    tmdb: {
      apiKey: env.TMDB_API_KEY?.trim() || null,
      region: env.TMDB_REGION.toUpperCase(),
      language: env.TMDB_LANGUAGE,
      cacheTtlSeconds: env.TMDB_CACHE_TTL_SECONDS,
    },
    watchmode: {
      apiKey: env.WATCHMODE_API_KEY?.trim() || null,
      region: env.WATCHMODE_REGION.toUpperCase(),
    },
    download: {
      engine: env.DOWNLOAD_ENGINE,
      aria2RpcUrl: env.ARIA2_RPC_URL,
      aria2Secret: env.ARIA2_RPC_SECRET?.trim() || null,
      directory: downloadDir,
      maxConcurrent: env.MAX_CONCURRENT_DOWNLOADS,
      maxBytes: env.MAX_DOWNLOAD_BYTES,
      bandwidthLimitKbps: env.BANDWIDTH_LIMIT_KBPS,
      connectTimeoutMs: env.CONNECT_TIMEOUT_MS,
      idleTimeoutMs: env.IDLE_TIMEOUT_MS,
      maxRedirects: env.MAX_REDIRECTS,
    },
    tools: { ffprobePath: env.FFPROBE_PATH, ffmpegPath: env.FFMPEG_PATH },
    security: {
      mediaRoots,
      allowPrivateAddresses: env.ALLOW_PRIVATE_ADDRESSES,
      allowedHttpHosts: env.ALLOWED_HTTP_HOSTS.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    },
  };
}

export const config: AppConfig = loadConfig();

/** True when the process is bound to something other than loopback. */
export function isExposedBeyondLoopback(): boolean {
  return !['127.0.0.1', 'localhost', '::1'].includes(config.host);
}
