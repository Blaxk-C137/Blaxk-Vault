/**
 * Path safety and media-organization tests (blueprint §7 and §9).
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildRelativeMediaPath,
  classifyRelativePath,
  isWithinRoot,
  resolveWithinRoot,
  sanitizeFileName,
  uniqueFilePath,
} from '../src/security/paths.js';
import { TEST_ROOT } from './setup.js';

describe('sanitizeFileName', () => {
  it('strips directory components and traversal sequences', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('..\\..\\windows\\system32\\cmd.exe')).toBe('cmd.exe');
    expect(sanitizeFileName('/absolute/path/movie.mp4')).toBe('movie.mp4');
  });

  it('removes control characters, quotes and pipe characters', () => {
    expect(sanitizeFileName('mo\u0000vie<>:"|?*.mp4')).toBe('movie.mp4');
  });

  it('refuses hidden files and leading dashes', () => {
    expect(sanitizeFileName('.hidden.mp4')).toBe('hidden.mp4');
    expect(sanitizeFileName('-rf.mp4')).toBe('rf.mp4');
  });

  it('neutralises reserved Windows device names', () => {
    const sanitized = sanitizeFileName('CON.mp4');
    expect(sanitized.toLowerCase().startsWith('con.')).toBe(false);
    expect(sanitized).not.toBe('CON.mp4');
  });

  it('caps filename length while keeping the extension', () => {
    const long = `${'a'.repeat(400)}.mkv`;
    const sanitized = sanitizeFileName(long);
    expect(sanitized.length).toBeLessThanOrEqual(180);
    expect(sanitized.endsWith('.mkv')).toBe(true);
  });
});

describe('resolveWithinRoot', () => {
  const root = path.join(TEST_ROOT, 'media');

  it('resolves legal nested paths', () => {
    const resolved = resolveWithinRoot(root, 'Movies/Film (1999)/Film (1999).mkv');
    expect(isWithinRoot(resolved, root)).toBe(true);
  });

  it('refuses traversal, absolute paths and sneaky separators', () => {
    expect(() => resolveWithinRoot(root, '../../etc/shadow')).toThrow(/outside the approved media directories/i);
    // Absolute input is refused outright rather than silently reinterpreted.
    expect(() => resolveWithinRoot(root, '/etc/shadow')).toThrow(/Absolute paths are rejected/i);
    expect(() => resolveWithinRoot(root, 'C:/windows/win.ini')).toThrow(/Absolute paths are rejected/i);
    expect(() => resolveWithinRoot(root, 'Movies/../../../etc/shadow')).toThrow(/outside the approved media directories/i);
    expect(() => resolveWithinRoot(root, '..\\..\\windows\\win.ini')).toThrow(/outside the approved media directories/i);
  });
});

describe('buildRelativeMediaPath', () => {
  it('lays films out as Movies/Name (Year)/Name (Year).ext', () => {
    const relative = buildRelativeMediaPath({
      kind: 'movie',
      title: 'Night of the Living Dead',
      year: 1968,
      fileName: 'night_of_the_living_dead_1080p',
      extension: '.mp4',
    });
    expect(relative).toBe('Movies/Night of the Living Dead (1968)/night_of_the_living_dead_1080p.mp4');
  });

  it('lays episodes out as Series/Name/Season 01/Name - S01E01.ext', () => {
    const relative = buildRelativeMediaPath({
      kind: 'tv',
      title: 'The Beverly Hillbillies',
      seasonNumber: 1,
      episodeNumber: 2,
      fileName: 'random_release_name',
      extension: 'mkv',
    });
    expect(relative).toBe('Series/The Beverly Hillbillies/Season 01/The Beverly Hillbillies - S01E02.mkv');
  });

  it('keeps an explicit episode code when the release name already has one', () => {
    const relative = buildRelativeMediaPath({
      kind: 'tv',
      title: 'Show',
      seasonNumber: 3,
      episodeNumber: 7,
      fileName: 'Show.S03E07.1080p',
      extension: 'mp4',
    });
    expect(relative).toBe('Series/Show/Season 03/Show.S03E07.1080p.mp4');
  });

  it('cannot escape the media directory through the title', () => {
    const relative = buildRelativeMediaPath({
      kind: 'movie',
      title: '../../../../etc/cron.d/evil',
      year: 2020,
      fileName: 'payload',
      extension: 'sh',
    });
    expect(relative.includes('..')).toBe(false);
    expect(relative.startsWith('Movies/')).toBe(true);
  });
});

describe('classifyRelativePath', () => {
  it('classifies films produced by BlaxkVault', () => {
    const parsed = classifyRelativePath('Movies/Night of the Living Dead (1968)/Night of the Living Dead (1968).mp4');
    expect(parsed.kind).toBe('movie');
    expect(parsed.title).toBe('Night of the Living Dead');
    expect(parsed.year).toBe(1968);
  });

  it('classifies episodes produced by BlaxkVault', () => {
    const parsed = classifyRelativePath('Series/The Beverly Hillbillies/Season 01/The Beverly Hillbillies - S01E02.mkv');
    expect(parsed.kind).toBe('tv');
    expect(parsed.seasonNumber).toBe(1);
    expect(parsed.episodeNumber).toBe(2);
  });

  it('classifies hand-curated episode files without a Series/ folder', () => {
    const parsed = classifyRelativePath('Stuff/Some.Show.S02E11.720p.mkv');
    expect(parsed.kind).toBe('tv');
    expect(parsed.seasonNumber).toBe(2);
    expect(parsed.episodeNumber).toBe(11);
  });
});

describe('uniqueFilePath', () => {
  it('appends a counter instead of overwriting', async () => {
    const fs = await import('node:fs');
    const dir = path.join(TEST_ROOT, 'unique');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'file.mp4');
    fs.writeFileSync(target, 'x');
    expect(uniqueFilePath(target)).toBe(path.join(dir, 'file (1).mp4'));
  });
});
