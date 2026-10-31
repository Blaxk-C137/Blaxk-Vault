/**
 * Title matching tests.
 *
 * Two separate guarantees, both learned from real mistakes:
 *   1. The shared normaliser decides identity the same way everywhere.
 *   2. The archive matcher rejects items that do not really match — offering a
 *      wrong film is worse than offering none. (It once suggested a Filipino
 *      exploitation feature as "D.O.A. (1949)".)
 */
import { describe, expect, it } from 'vitest';
import { normalizeTitle, titleAgreement, titleTokens } from '@blaxkvault/shared';
import { scoreArchiveCandidate } from '../src/adapters/index.js';
import type { ArchiveSearchItem } from '../src/adapters/archive.js';

function item(overrides: Partial<ArchiveSearchItem> & { title: string }): ArchiveSearchItem {
  return {
    identifier: 'some-item',
    year: 1950,
    mediatype: 'movies',
    rightsPermitted: true,
    rightsNote: 'open licence',
    itemUrl: 'https://archive.org/details/some-item',
    thumbnailUrl: '',
    ...overrides,
  };
}

describe('normalizeTitle', () => {
  it('treats punctuation, case and articles as noise', () => {
    expect(normalizeTitle('The Cabinet of Dr. Caligari')).toBe('cabinet dr caligari');
    expect(normalizeTitle('the CABINET of Dr Caligari!')).toBe('cabinet dr caligari');
    expect(normalizeTitle('D.O.A.')).toBe('d o a');
  });

  it('strips accents so international titles still compare', () => {
    expect(normalizeTitle('Amélie')).toBe(normalizeTitle('Amelie'));
    expect(normalizeTitle('Björk')).toBe(normalizeTitle('Bjork'));
  });

  it('collapses whitespace and empty input', () => {
    expect(normalizeTitle('   ')).toBe('');
    expect(normalizeTitle('Metropolis   1927')).toBe('metropolis 1927');
  });
});

describe('titleAgreement', () => {
  it('scores a real match as full agreement', () => {
    expect(titleAgreement('Nosferatu', 'Nosferatu (1922)')).toBe(1);
    expect(titleAgreement('The General', 'The General Buster Keaton')).toBe(1);
  });

  it('scores an unrelated title as zero', () => {
    expect(titleAgreement('D.O.A.', 'pinoy rated r')).toBe(0);
    expect(titleAgreement('Metropolis', 'Night of the Living Dead')).toBe(0);
  });

  it('scores a partial overlap proportionally', () => {
    // "The Last Man" shares half of "The Last Man on Earth"'s distinctive words,
    // which is exactly why the 0.6 gate rejects it as a different film.
    expect(titleAgreement('The Last Man on Earth', 'The Last Man')).toBe(0.5);
  });

  it('does not match on a shared article alone', () => {
    expect(titleTokens('The Thing')).toEqual(['thing']);
    expect(titleAgreement('The Thing', 'The Cabinet of Dr Caligari')).toBe(0);
  });
});

describe('scoreArchiveCandidate', () => {
  it('accepts a title and year that agree', () => {
    const score = scoreArchiveCandidate(item({ title: 'Nosferatu', year: 1922 }), 'Nosferatu', 1922);
    expect(score).toBeGreaterThan(40);
  });

  it('rejects an item whose metadata does not mention the title', () => {
    expect(scoreArchiveCandidate(item({ title: 'pinoy rated r', year: 2001 }), 'D.O.A.', 1949)).toBe(-100);
  });

  it('rejects a much later remake of the same name', () => {
    expect(scoreArchiveCandidate(item({ title: 'D.O.A.', year: 1988 }), 'D.O.A.', 1949)).toBe(-100);
  });

  it('accepts a one-year disagreement (release vs copyright year)', () => {
    expect(scoreArchiveCandidate(item({ title: 'Charade', year: 1964 }), 'Charade', 1963)).toBeGreaterThan(40);
  });

  it('does not punish an item that states no year', () => {
    const withYear = scoreArchiveCandidate(item({ title: 'Metropolis', year: 1927 }), 'Metropolis', 1927);
    const withoutYear = scoreArchiveCandidate(item({ title: 'Metropolis', year: undefined }), 'Metropolis', 1927);
    expect(withoutYear).toBeGreaterThan(40);
    expect(withoutYear).toBeLessThan(withYear);
  });

  it('prefers the item that carries open rights', () => {
    const permitted = scoreArchiveCandidate(item({ title: 'Metropolis', year: 1927, rightsPermitted: true }), 'Metropolis', 1927);
    const unclear = scoreArchiveCandidate(item({ title: 'Metropolis', year: 1927, rightsPermitted: false }), 'Metropolis', 1927);
    expect(permitted).toBeGreaterThan(unclear);
  });

  it('accepts a description-style title that contains the film name', () => {
    const score = scoreArchiveCandidate(
      item({ title: 'The Cabinet Of Dr. Caligari (with spanish subtitles)', year: 1920 }),
      'The Cabinet of Dr. Caligari',
      1920,
    );
    expect(score).toBeGreaterThan(40);
  });
});
