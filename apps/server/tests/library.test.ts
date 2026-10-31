/**
 * Library scan tests.
 *
 * A scan must be *idempotent*: running it twice over unchanged files must report
 * nothing new and nothing removed, and changing which folder is a media root
 * must never look like "one file deleted, one file added" — that would silently
 * drop the item's id, its playback position and the date it was added.
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_ROOT } from './setup.js';
// setup.ts runs before this module is imported, so configuration is already in place.
import { initDatabase } from '../src/db/index.js';
import { scanLibrary, listLibrary, saveProgress, getProgress, findLocalCopies } from '../src/services/library.js';
import { invalidateSettingsCache, patchSettings } from '../src/services/settings.js';

const VAULT = path.join(TEST_ROOT, 'vault');
const MOVIE_DIR = path.join(VAULT, 'Movies', 'Scan Fixture (1999)');
const MOVIE_FILE = path.join(MOVIE_DIR, 'scan-fixture.mp4');

function writeFixtureFile(file: string, bytes = 2048): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = Buffer.alloc(bytes, 7);
  body.writeUInt32BE(24, 0);
  body.write('ftypisom', 4, 'latin1');
  fs.writeFileSync(file, body);
}

describe('library scan', () => {
  beforeAll(() => {
    initDatabase();
    writeFixtureFile(MOVIE_FILE);
    // The vault folder is the download directory; the parent is also a root, the
    // way an existing collection would be configured alongside it. Roots are set
    // first because the download directory must already be inside one of them.
    patchSettings({ mediaRoots: [TEST_ROOT] });
    patchSettings({ downloadDir: VAULT });
    invalidateSettingsCache();
  });

  it('indexes a new file once', async () => {
    const result = await scanLibrary({ probe: false });
    expect(result.fileCount).toBe(1);

    const items = listLibrary({});
    const item = items.find((i) => i.fileName === 'scan-fixture.mp4');
    expect(item, 'the fixture file should be indexed').toBeTruthy();
  });

  it('is idempotent: a second scan over unchanged files reports no churn', async () => {
    const second = await scanLibrary({ probe: false });
    expect(second.fileCount).toBe(1);
    expect(second.newItems).toBe(0);
    expect(second.removedItems).toBe(0);
  });

  it('keeps exactly one entry for a file that is reachable through nested roots', async () => {
    const matches = listLibrary({}).filter((i) => i.fileName === 'scan-fixture.mp4');
    expect(matches.length, `expected one entry, found ${matches.length}`).toBe(1);
  });

  it('migrates an item when the media roots change, keeping its id and position', async () => {
    const before = listLibrary({}).find((i) => i.fileName === 'scan-fixture.mp4')!;
    saveProgress({ itemId: before.id, positionSeconds: 412, durationSeconds: 3600 });
    expect(getProgress(before.id)?.positionSeconds).toBe(412);

    // The parent folder stops being a root (exactly what happens when MEDIA_ROOTS
    // is emptied, or when the download directory is changed in Settings).
    patchSettings({ mediaRoots: [] });
    invalidateSettingsCache();

    const after = await scanLibrary({ probe: false });

    // The same physical file: not new, not removed.
    expect(after.fileCount).toBe(1);
    expect(after.newItems).toBe(0);
    expect(after.removedItems).toBe(0);

    const matches = listLibrary({}).filter((i) => i.fileName === 'scan-fixture.mp4');
    expect(matches.length, 'a changed root must not duplicate the entry').toBe(1);
    const item = matches[0]!;

    expect(item.id, 'the item id must survive a root change').toBe(before.id);
    expect(item.relativePath, 'the path is now relative to the shallowest root').toBe('Movies/Scan Fixture (1999)/scan-fixture.mp4');
    expect(item.missing, 'the file still exists, so it must not be flagged missing').toBeFalsy();
    expect(getProgress(item.id)?.positionSeconds, 'resume position must survive a root change').toBe(412);
  });

  it('matches a catalogue title to the file already on disk', () => {
    const copies = findLocalCopies({ title: 'Scan Fixture', year: 1999, kind: 'movie' });
    expect(copies.length).toBe(1);
    expect(copies[0]!.fileName).toBe('scan-fixture.mp4');
    expect(copies[0]!.missing).toBe(false);
  });

  it('accepts punctuation and article differences', () => {
    expect(findLocalCopies({ title: 'The Scan Fixture!', year: 1999 }).length).toBe(1);
    expect(findLocalCopies({ title: 'the  scan   fixture', year: 1999 }).length).toBe(1);
  });

  it('accepts a one-year disagreement but not a different film', () => {
    // Release year vs copyright year is a one-year disagreement; a remake is not.
    expect(findLocalCopies({ title: 'Scan Fixture', year: 2000 }).length).toBe(1);
    expect(findLocalCopies({ title: 'Scan Fixture', year: 2024 }).length).toBe(0);
  });

  it('never matches a different title that shares a word', () => {
    expect(findLocalCopies({ title: 'Fixture', year: 1999 }).length).toBe(0);
    expect(findLocalCopies({ title: 'Scan', year: 1999 }).length).toBe(0);
    expect(findLocalCopies({ title: 'The Scan Fixture Returns', year: 1999 }).length).toBe(0);
  });

  it('matches on title alone when neither side states a year', () => {
    expect(findLocalCopies({ title: 'Scan Fixture' }).length).toBe(1);
  });

  it('heals duplicate rows left behind by an earlier root change', async () => {
    // Simulate the damage an older build produced: a ghost row for the same
    // absolute file under the previous root, already flagged missing.
    const { getDb } = await import('../src/db/index.js');
    const { libraryItems } = await import('../src/db/schema.js');
    const db = getDb().db;
    db.insert(libraryItems)
      .values({
        id: 'ghost-row-0000000000',
        root: TEST_ROOT,
        relativePath: 'vault/Movies/Scan Fixture (1999)/scan-fixture.mp4',
        fileName: 'scan-fixture.mp4',
        kind: 'movie',
        sizeBytes: 2048,
        extension: 'mp4',
        modifiedAt: new Date().toISOString(),
        title: 'Scan Fixture',
        year: 1999,
        subtitlesJson: '[]',
        missing: 1,
        addedAt: new Date().toISOString(),
      })
      .run();

    await scanLibrary({ probe: false });

    const matches = listLibrary({}).filter((i) => i.fileName === 'scan-fixture.mp4');
    expect(matches.length, 'the ghost row should have been removed').toBe(1);
    expect(matches[0]!.missing).toBeFalsy();
  });
});
