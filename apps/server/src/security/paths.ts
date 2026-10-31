/**
 * Filesystem safety (blueprint §9): sanitised filenames, path-traversal
 * protection and "never write outside an approved media root".
 *
 * Every path the app derives from user input flows through here. There is no
 * code path that joins an untrusted string onto a base directory directly.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { MediaKind } from '@blaxkvault/shared';
import { config } from '../config.js';
import { AppError, badRequest } from '../lib/errors.js';

const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** Characters that must never reach the filesystem. */
// eslint-disable-next-line no-control-regex
const ILLEGAL = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

export function sanitizeFileName(input: string, fallback = 'media'): string {
  let name = (input ?? '').toString();
  // Strip any directory component an attacker may have injected.
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(ILLEGAL, '');
  name = name.replace(/\s+/g, ' ').trim();
  // No leading dots (hidden files) or dashes (CLI option injection).
  name = name.replace(/^[.\-\s]+/, '');
  name = name.replace(/[.\s]+$/, '');
  if (name.length > 180) {
    const ext = path.extname(name).slice(0, 12);
    name = `${name.slice(0, 180 - ext.length)}${ext}`;
  }
  const base = name.replace(/\.[^.]+$/, '') || '';
  if (!name || WINDOWS_RESERVED.has(base.toLowerCase()) || WINDOWS_RESERVED.has(name.toLowerCase())) {
    name = `${fallback}-${Date.now().toString(36)}`;
  }
  return name;
}

export function sanitizeDirectoryName(input: string, fallback = 'Untitled'): string {
  const cleaned = sanitizeFileName(input, fallback).replace(/\.+$/, '').trim();
  return cleaned || fallback;
}

export function isWithinRoot(candidate: string, root: string): boolean {
  const rootResolved = path.resolve(root);
  const candidateResolved = path.resolve(candidate);
  if (candidateResolved === rootResolved) return true;
  const rel = path.relative(rootResolved, candidateResolved);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Resolve `relative` inside `root`, refusing anything that escapes it. */
export function resolveWithinRoot(root: string, relative: string): string {
  const asPosix = relative.replace(/\\/g, '/');
  // Callers only ever pass paths produced by buildRelativeMediaPath. An absolute
  // path or a drive letter here means something upstream is wrong (or hostile),
  // so it is refused rather than silently reinterpreted.
  if (asPosix.startsWith('/') || /^[a-zA-Z]:\//.test(asPosix)) {
    throw new AppError('FORBIDDEN', 'Absolute paths are rejected. Paths must be relative to an approved media root.');
  }
  const normalizedRelative = asPosix.replace(/^\/+/, '');
  const resolved = path.resolve(root, normalizedRelative);
  if (!isWithinRoot(resolved, root)) {
    throw new AppError('FORBIDDEN', 'That path is outside the approved media directories.');
  }
  return resolved;
}

/** Resolve a path that must live inside one of the configured media roots. */
/**
 * The path a stored file is known by in the library: relative to the shallowest
 * media root that contains it. Downloads and library scans both use this, so a
 * finished download and its library entry always agree on one string.
 */
export function relativeToMediaRoots(absolutePath: string): string {
  const absolute = path.resolve(absolutePath);
  // Deliberately the *configured* roots (which always include the download
  // directory) rather than the live settings value: importing the settings
  // service here would create an import cycle, and downloads only ever land in
  // the download directory anyway.
  const roots = Array.from(new Set(config.security.mediaRoots)).map((root) => path.resolve(root));
  const containing = roots
    .filter((root) => isWithinRoot(absolute, root))
    .sort((a, b) => a.length - b.length);
  const root = containing[0] ?? config.download.directory;
  return path.relative(root, absolute).split(path.sep).join('/');
}

export function resolveInsideMediaRoots(candidate: string): { absolute: string; root: string } {
  const resolved = path.resolve(candidate);
  for (const root of config.security.mediaRoots) {
    if (isWithinRoot(resolved, root)) return { absolute: resolved, root };
  }
  throw new AppError(
    'FORBIDDEN',
    'That location is outside every approved media root. Add it to MEDIA_ROOTS or move the file into the download directory.',
  );
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Append ` (n)` until the path is free, so two downloads never clobber one file. */
export function uniqueFilePath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const stem = path.basename(targetPath, ext);
  for (let i = 1; i < 500; i += 1) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(dir, `${stem}-${Date.now().toString(36)}${ext}`);
}

export interface MediaPathInput {
  kind: MediaKind | undefined;
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  fileName: string;
  extension: string;
}

/**
 * Predictable on-disk layout (blueprint §7):
 *   Movies/Movie Name (Year)/Movie Name (Year).mkv
 *   Series/Series Name/Season 01/Series Name - S01E01.mp4
 */
export function buildRelativeMediaPath(input: MediaPathInput): string {
  const title = sanitizeDirectoryName(input.title, 'Untitled');
  const ext = (input.extension || 'mp4').replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const yearPart = input.year ? ` (${input.year})` : '';
  const dirTitle = `${title}${yearPart}`;

  /** Never produce "file.mp4.mp4" when the source name already carries the extension. */
  const stripDuplicateExtension = (name: string): string => {
    const sanitized = sanitizeFileName(name, dirTitle);
    return sanitized.toLowerCase().endsWith(`.${ext}`) ? sanitized.slice(0, -(ext.length + 1)) : sanitized;
  };

  if (input.kind === 'tv' && input.seasonNumber !== undefined && input.episodeNumber !== undefined) {
    const season = `Season ${String(input.seasonNumber).padStart(2, '0')}`;
    const code = `S${String(input.seasonNumber).padStart(2, '0')}E${String(input.episodeNumber).padStart(2, '0')}`;
    const baseName = stripDuplicateExtension(input.fileName);
    // If the incoming name already encodes the episode code, keep it as-is.
    const finalBase = /s\d{1,2}e\d{1,3}/i.test(baseName) ? baseName : `${title} - ${code}`;
    return path.posix.join('Series', dirTitle, season, `${finalBase}.${ext}`);
  }

  const baseName = stripDuplicateExtension(input.fileName);
  return path.posix.join('Movies', dirTitle, `${baseName}.${ext}`);
}

/** Guess a media kind from a library-relative path produced by us or a human. */
export function classifyRelativePath(relativePath: string): {
  kind: MediaKind | 'other';
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
} {
  const parts = relativePath.split('/').filter(Boolean);
  const file = parts[parts.length - 1] ?? '';
  const stem = file.replace(/\.[^.]+$/, '');
  const first = (parts[0] ?? '').toLowerCase();

  const episodeCode = /s(\d{1,2})[\s._-]*e(\d{1,3})/i.exec(stem);
  if (first === 'series' || first === 'shows' || episodeCode) {
    const titlePart = parts[1] ?? stem.replace(/ - S\d+E\d+.*$/i, '');
    const seasonFromFolder = /season\s*(\d{1,2})/i.exec(parts.find((p) => /^season/i.test(p)) ?? '');
    const title = titlePart.replace(/\s*\(\d{4}\)\s*$/, '').replace(/[_]+/g, ' ').trim() || stem;
    const yearMatch = /\((\d{4})\)/.exec(titlePart);
    return {
      kind: 'tv',
      title,
      year: yearMatch ? Number.parseInt(yearMatch[1]!, 10) : undefined,
      seasonNumber: episodeCode ? Number.parseInt(episodeCode[1]!, 10) : seasonFromFolder ? Number.parseInt(seasonFromFolder[1]!, 10) : undefined,
      episodeNumber: episodeCode ? Number.parseInt(episodeCode[2]!, 10) : undefined,
    };
  }

  const yearMatch = /\((\d{4})\)/.exec(parts[1] ?? stem) ?? /\((\d{4})\)/.exec(stem);
  const titleGuess = (parts[1] ?? stem)
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return {
    kind: first === 'movies' || first === 'films' ? 'movie' : 'other',
    title: titleGuess || stem,
    year: yearMatch ? Number.parseInt(yearMatch[1]!, 10) : undefined,
  };
}

export function assertNotSymlinkEscape(absolutePath: string, root: string): void {
  try {
    const real = fs.realpathSync(absolutePath);
    if (!isWithinRoot(real, fs.realpathSync(root))) {
      throw new AppError('FORBIDDEN', 'That file resolves outside the approved media root (symlink escape).');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw badRequest('That path could not be inspected.');
  }
}
