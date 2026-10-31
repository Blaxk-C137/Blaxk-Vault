/**
 * Rights gating tests for the Internet Archive adapter.
 *
 * The rule under test (blueprint §6): "presence of a file alone does not prove
 * permission". Only items that state a verifiable open licence or public-domain
 * status may be reported as available for download.
 */
import { describe, expect, it } from 'vitest';
import { assessArchiveRights, pickBestFile, itemToFiles } from '../src/adapters/archive.js';

describe('assessArchiveRights', () => {
  it('permits a Creative Commons licence URL', () => {
    const result = assessArchiveRights({ licenseurl: 'https://creativecommons.org/publicdomain/mark/1.0/' });
    expect(result.permitted).toBe(true);
    expect(result.note).toMatch(/open licence/i);
  });

  it('permits CC-BY licences and keeps the attribution warning', () => {
    const result = assessArchiveRights({ licenseurl: 'http://creativecommons.org/licenses/by/4.0/' });
    expect(result.permitted).toBe(true);
  });

  it('permits a plain public-domain rights statement', () => {
    expect(assessArchiveRights({ rights: 'Public Domain' }).permitted).toBe(true);
    expect(assessArchiveRights({ 'possible-copyright-status': 'NOT_IN_COPYRIGHT' }).permitted).toBe(true);
    expect(assessArchiveRights({ rights: 'No known copyright restrictions' }).permitted).toBe(true);
  });

  it('permits recognised open collections', () => {
    expect(assessArchiveRights({ collection: ['publicdomain'] }).permitted).toBe(true);
    expect(assessArchiveRights({ collection: 'prelinger' }).permitted).toBe(true);
  });

  it('refuses an unrecognised licence', () => {
    const result = assessArchiveRights({ licenseurl: 'https://example.com/our-terms' });
    expect(result.permitted).toBe(false);
    expect(result.note).toMatch(/cannot verify/i);
  });

  it('refuses an item with no rights metadata at all, and explains why', () => {
    const result = assessArchiveRights({ title: 'Some Studio Film', collection: ['feature_films'] });
    expect(result.permitted).toBe(false);
    expect(result.note).toMatch(/does not state a public-domain status or an open licence/i);
  });

  it('refuses when metadata is entirely missing', () => {
    expect(assessArchiveRights(undefined).permitted).toBe(false);
  });
});

describe('pickBestFile', () => {
  it('prefers a browser-playable h.264 mp4 over a larger archive.org derivative', () => {
    const best = pickBestFile([
      { name: 'movie.ogv', format: 'Ogg Video', sizeBytes: 400_000_000 },
      { name: 'movie.mp4', format: 'h.264', sizeBytes: 250_000_000 },
      { name: 'movie_512kb.mp4', format: '512Kb MPEG4', sizeBytes: 150_000_000 },
    ]);
    expect(best?.name).toBe('movie.mp4');
  });

  it('falls back to any media file when none is browser-playable', () => {
    const best = pickBestFile([{ name: 'movie.mkv', format: 'Matroska', sizeBytes: 900_000 }]);
    expect(best?.name).toBe('movie.mkv');
  });

  it('returns undefined for an empty file list', () => {
    expect(pickBestFile([])).toBeUndefined();
  });
});

describe('itemToFiles', () => {
  it('drops thumbnails, torrents, metadata files and non-media derivatives', () => {
    const files = itemToFiles({
      files: [
        { name: '__ia_thumb.jpg' },
        { name: 'movie.mp4', format: 'h.264', size: '12345' },
        { name: 'movie_meta.xml' },
        { name: 'movie.torrent' },
        { name: 'movie_spectrogram.png' },
        { name: 'subtitles.srt' },
        { name: 'poster.jpg' },
      ],
    });
    expect(files.map((f) => f.name)).toEqual(['movie.mp4']);
    expect(files[0]?.sizeBytes).toBe(12345);
  });
});
