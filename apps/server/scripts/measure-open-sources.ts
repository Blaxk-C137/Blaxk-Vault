/**
 * Open-source coverage benchmark.
 *
 * Measures how many titles the downloadability matcher can actually satisfy from
 * the shipped open sources — half public-domain classics that genuinely exist on
 * the Internet Archive, half openly-licensed modern works. Run it after touching
 * the matcher:
 *
 *   npx tsx apps/server/scripts/measure-open-sources.ts
 *
 * It is a measurement tool, not a test: network results change, and a miss is
 * information (the matcher may need work, or the title genuinely has no open
 * copy). It never fabricates a result to look better.
 */
import { assessDownloadability } from '../src/adapters/index.js';

const TITLES: [string, number, 'movie' | 'tv'][] = [
  // Public-domain feature films that are on the Internet Archive.
  ['The Kid', 1921, 'movie'],
  ['Sherlock Jr.', 1924, 'movie'],
  ['Safety Last!', 1923, 'movie'],
  ['Plan 9 from Outer Space', 1959, 'movie'],
  ['Detour', 1945, 'movie'],
  ['D.O.A.', 1949, 'movie'],
  ['The Little Shop of Horrors', 1960, 'movie'],
  ['Meet John Doe', 1941, 'movie'],
  ['The Stranger', 1946, 'movie'],
  ['Beat the Devil', 1953, 'movie'],
  ['The Last Man on Earth', 1964, 'movie'],
  ['House on Haunted Hill', 1959, 'movie'],
  ['The Phantom of the Opera', 1925, 'movie'],
  ['The Hunchback of Notre Dame', 1923, 'movie'],
  ['A Trip to the Moon', 1902, 'movie'],
  ['Nanook of the North', 1922, 'movie'],
  ['The Lodger', 1927, 'movie'],
  ['Nosferatu', 1922, 'movie'],
  ['Metropolis', 1927, 'movie'],
  ['Charade', 1963, 'movie'],
  ['His Girl Friday', 1940, 'movie'],
  ['Carnival of Souls', 1962, 'movie'],
  ['The General', 1926, 'movie'],
  ['Battleship Potemkin', 1925, 'movie'],
  ['Night of the Living Dead', 1968, 'movie'],
  ['The Cabinet of Dr. Caligari', 1920, 'movie'],
  // Modern openly-licensed works (Blender Foundation, CC-BY).
  ['Big Buck Bunny', 2008, 'movie'],
  ['Sintel', 2010, 'movie'],
  ['Tears of Steel', 2012, 'movie'],
  ['Elephants Dream', 2006, 'movie'],
];

async function main(): Promise<void> {
  let ok = 0;
  const misses: string[] = [];

  for (const [title, year, kind] of TITLES) {
    try {
      const assessment = await assessDownloadability({ kind, title, year }, { maxCandidates: 2 });
      const available = assessment.candidates.filter((c) => c.status === 'available');
      if (assessment.status === 'available' && available.length > 0) {
        ok += 1;
        const best = available[0]!;
        const size = best.sizeBytes ? ` ${(best.sizeBytes / 1024 ** 2).toFixed(0)}MB` : '';
        console.log(`HIT   ${title} (${year}) -> ${best.sourceLabel}${size}`);
      } else {
        misses.push(`${title} (${year}) [${assessment.status}]`);
        console.log(`MISS  ${title} (${year})  ${assessment.status}`);
      }
    } catch (error) {
      misses.push(`${title} ERROR ${(error as Error).message}`);
      console.log(`ERR   ${title}: ${(error as Error).message}`);
    }
  }

  console.log(`\n${ok}/${TITLES.length} titles found a permitted file`);
  if (misses.length > 0) console.log(`missed: ${misses.join(' | ')}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
