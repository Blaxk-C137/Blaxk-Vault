/**
 * Settings service.
 *
 * Effective settings = validated environment defaults, overridden by rows the
 * user saved in SQLite. Secrets are never part of the response: the client only
 * learns *whether* a credential is configured.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { AppSettings, DiskUsage, SettingsPatch } from '@blaxkvault/shared';
import { config } from '../config.js';
import { getDb } from '../db/index.js';
import { settings as settingsTable } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { isWithinRoot } from '../security/paths.js';
import { hasFfmpeg, hasFfprobe } from '../engine/probe.js';

const KEYS = {
  downloadDir: 'download.dir',
  maxConcurrentDownloads: 'download.maxConcurrent',
  bandwidthLimitKbps: 'download.bandwidthLimitKbps',
  maxDownloadBytes: 'download.maxBytes',
  theme: 'ui.theme',
  reducedMotion: 'ui.reducedMotion',
  tmdbRegion: 'tmdb.region',
  tmdbLanguage: 'tmdb.language',
  watchmodeRegion: 'watchmode.region',
  aria2Enabled: 'download.aria2Enabled',
  aria2RpcUrl: 'aria2.rpcUrl',
  mediaRoots: 'library.mediaRoots',
} as const;

type SettingKey = (typeof KEYS)[keyof typeof KEYS];

function readOverrides(): Record<string, string> {
  try {
    const { db } = getDb();
    const rows = db.select().from(settingsTable).all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } catch {
    return {};
  }
}

function writeOverride(key: SettingKey, value: unknown): void {
  const { db } = getDb();
  const serialized = JSON.stringify(value);
  db.insert(settingsTable)
    .values({ key, value: serialized, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: serialized, updatedAt: new Date().toISOString() } })
    .run();
}

export function diskUsage(target = config.download.directory): DiskUsage {
  try {
    fs.mkdirSync(target, { recursive: true });
    const stat = fs.statfsSync(target);
    const totalBytes = stat.blocks * stat.bsize;
    const freeBytes = stat.bavail * stat.bsize;
    return { path: target, totalBytes, freeBytes, usedBytes: totalBytes - freeBytes };
  } catch (err) {
    return { path: target, error: `Could not read disk usage for that path (${(err as NodeJS.ErrnoException).code ?? 'unknown error'}).` };
  }
}

let runtimeOverridesCache: Record<string, string> | null = null;

function overrides(): Record<string, string> {
  if (!runtimeOverridesCache) runtimeOverridesCache = readOverrides();
  return runtimeOverridesCache;
}

export function invalidateSettingsCache(): void {
  runtimeOverridesCache = null;
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getEffectiveDownloadSettings(): {
  maxConcurrent: number;
  bandwidthLimitKbps: number;
  maxBytes: number;
  directory: string;
} {
  const o = overrides();
  return {
    maxConcurrent: Math.max(1, Math.round(num(o[KEYS.maxConcurrentDownloads], config.download.maxConcurrent))),
    bandwidthLimitKbps: Math.max(0, Math.round(num(o[KEYS.bandwidthLimitKbps], config.download.bandwidthLimitKbps))),
    maxBytes: Math.max(0, Math.round(num(o[KEYS.maxDownloadBytes], config.download.maxBytes))),
    directory: o[KEYS.downloadDir] ? String(JSON.parse(o[KEYS.downloadDir]!)) : config.download.directory,
  };
}

export function getMediaRoots(): string[] {
  const o = overrides();
  const stored = o[KEYS.mediaRoots];
  const roots = stored ? (JSON.parse(stored) as string[]) : config.security.mediaRoots;
  const directory = getEffectiveDownloadSettings().directory;
  return Array.from(new Set([...roots, directory]));
}

export function getSettings(): AppSettings {
  const o = overrides();
  const download = getEffectiveDownloadSettings();
  return {
    downloadDir: download.directory,
    maxConcurrentDownloads: download.maxConcurrent,
    bandwidthLimitKbps: download.bandwidthLimitKbps,
    maxDownloadBytes: download.maxBytes,
    theme: (o[KEYS.theme] ? JSON.parse(o[KEYS.theme]!) : 'dark') as AppSettings['theme'],
    reducedMotion: (o[KEYS.reducedMotion] ? JSON.parse(o[KEYS.reducedMotion]!) : 'system') as AppSettings['reducedMotion'],
    tmdbRegion: o[KEYS.tmdbRegion] ? JSON.parse(o[KEYS.tmdbRegion]!) : config.tmdb.region,
    tmdbLanguage: o[KEYS.tmdbLanguage] ? JSON.parse(o[KEYS.tmdbLanguage]!) : config.tmdb.language,
    watchmodeRegion: o[KEYS.watchmodeRegion] ? JSON.parse(o[KEYS.watchmodeRegion]!) : config.watchmode.region,
    aria2Enabled: o[KEYS.aria2Enabled] ? JSON.parse(o[KEYS.aria2Enabled]!) : config.download.engine === 'aria2',
    aria2RpcUrl: o[KEYS.aria2RpcUrl] ? String(JSON.parse(o[KEYS.aria2RpcUrl]!)) : config.download.aria2RpcUrl,
    aria2SecretConfigured: Boolean(config.download.aria2Secret),
    ffprobeAvailable: hasFfprobe(),
    ffmpegAvailable: hasFfmpeg(),
    mediaRoots: getMediaRoots(),
    disk: diskUsage(download.directory),
  };
}

export interface PatchResult {
  settings: AppSettings;
  changed: string[];
  warnings: string[];
}

export function patchSettings(patch: SettingsPatch): PatchResult {
  const changed: string[] = [];
  const warnings: string[] = [];
  const o = overrides();

  if (patch.downloadDir !== undefined) {
    const resolved = path.resolve(patch.downloadDir);
    const roots = getMediaRoots();
    if (!roots.some((root) => isWithinRoot(resolved, root)) && !isWithinRoot(resolved, config.download.directory)) {
      throw new AppError(
        'FORBIDDEN',
        'The download directory must sit inside one of the approved media roots. Add the parent folder to MEDIA_ROOTS (or the media roots setting) first.',
      );
    }
    try {
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch {
      throw new AppError('FORBIDDEN', 'BlaxkVault cannot write to that directory. Check permissions and try again.');
    }
    writeOverride(KEYS.downloadDir, resolved);
    changed.push('downloadDir');
  }

  if (patch.mediaRoots !== undefined) {
    const resolvedRoots = patch.mediaRoots.map((r) => path.resolve(r));
    for (const root of resolvedRoots) {
      if (!fs.existsSync(root)) warnings.push(`Media root "${root}" does not exist yet — it will be skipped until it does.`);
      else if (!fs.statSync(root).isDirectory()) warnings.push(`Media root "${root}" is not a directory and was ignored.`);
    }
    writeOverride(KEYS.mediaRoots, resolvedRoots);
    changed.push('mediaRoots');
  }

  if (patch.maxConcurrentDownloads !== undefined) {
    writeOverride(KEYS.maxConcurrentDownloads, patch.maxConcurrentDownloads);
    changed.push('maxConcurrentDownloads');
  }
  if (patch.bandwidthLimitKbps !== undefined) {
    writeOverride(KEYS.bandwidthLimitKbps, patch.bandwidthLimitKbps);
    changed.push('bandwidthLimitKbps');
  }
  if (patch.maxDownloadBytes !== undefined) {
    writeOverride(KEYS.maxDownloadBytes, patch.maxDownloadBytes);
    changed.push('maxDownloadBytes');
  }
  if (patch.theme !== undefined) {
    writeOverride(KEYS.theme, patch.theme);
    changed.push('theme');
  }
  if (patch.reducedMotion !== undefined) {
    writeOverride(KEYS.reducedMotion, patch.reducedMotion);
    changed.push('reducedMotion');
  }
  if (patch.tmdbRegion !== undefined) {
    writeOverride(KEYS.tmdbRegion, patch.tmdbRegion.toUpperCase());
    changed.push('tmdbRegion');
  }
  if (patch.tmdbLanguage !== undefined) {
    writeOverride(KEYS.tmdbLanguage, patch.tmdbLanguage);
    changed.push('tmdbLanguage');
  }
  if (patch.watchmodeRegion !== undefined) {
    writeOverride(KEYS.watchmodeRegion, patch.watchmodeRegion.toUpperCase());
    changed.push('watchmodeRegion');
  }
  if (patch.aria2Enabled !== undefined) {
    writeOverride(KEYS.aria2Enabled, patch.aria2Enabled);
    changed.push('aria2Enabled');
    if (patch.aria2Enabled && config.download.engine !== 'aria2') {
      warnings.push('aria2 was enabled in settings, but the server was started with DOWNLOAD_ENGINE=native. Set DOWNLOAD_ENGINE=aria2 and restart for the engine to switch.');
    }
  }
  if (patch.aria2RpcUrl !== undefined) {
    if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(patch.aria2RpcUrl)) {
      throw new AppError('FORBIDDEN', 'The aria2 RPC URL must be a loopback address (127.0.0.1 or localhost).');
    }
    writeOverride(KEYS.aria2RpcUrl, patch.aria2RpcUrl);
    changed.push('aria2RpcUrl');
  }

  invalidateSettingsCache();
  o && Object.keys(o); // touch to keep the reference used above meaningful
  return { settings: getSettings(), changed, warnings };
}

export function settingsSummaryForHealth(): { tmdb: boolean; watchmode: boolean } {
  return { tmdb: Boolean(config.tmdb.apiKey), watchmode: Boolean(config.watchmode.apiKey) };
}

export function effectiveRegions(): { tmdb: string; watchmode: string; language: string } {
  const s = getSettings();
  return { tmdb: s.tmdbRegion, watchmode: s.watchmodeRegion, language: s.tmdbLanguage };
}
