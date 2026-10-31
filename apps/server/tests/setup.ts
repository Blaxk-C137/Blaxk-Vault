/**
 * Vitest setup: point the app at a throwaway database and media root *before*
 * any module reads configuration (config.ts validates env at import time).
 *
 * ALLOW_PRIVATE_ADDRESSES is enabled here only so tests can talk to a local
 * fixture HTTP server. The SSRF guard's blocking behaviour is verified
 * separately, with the flag turned back off, in url-guard.test.ts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'blaxkvault-test-'));
export const TEST_ROOT = base;

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = path.join(base, 'test.db');
process.env.DOWNLOAD_DIR = path.join(base, 'media');
process.env.MEDIA_ROOTS = path.join(base, 'media');
process.env.ALLOW_PRIVATE_ADDRESSES = 'true';
process.env.DOWNLOAD_ENGINE = 'native';
process.env.MAX_CONCURRENT_DOWNLOADS = '2';
process.env.IDLE_TIMEOUT_MS = '10000';
process.env.CONNECT_TIMEOUT_MS = '5000';
process.env.FFPROBE_PATH = 'ffprobe-does-not-exist';
