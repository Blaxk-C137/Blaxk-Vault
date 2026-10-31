/**
 * Offline sample catalogue.
 *
 * Why this exists: BlaxkVault ships with a *real* TMDB integration, but TMDB
 * requires the operator's own API key. Without a key the app must not pretend
 * to be online, and must not ship scraped poster URLs or fabricated poster
 * paths. So the fallback is a tiny, clearly-labelled fixture of factual
 * metadata (title, year, runtime, director, genres) for well-known public-domain
 * and mainstream titles written by us — no external image URLs, no invented
 * download links. Every response built from this fixture is marked `mock: true`
 * and the UI renders an explicit "Sample catalogue" badge.
 *
 * Fixture entries carry `publicDomain: true` when the work is generally
 * accepted to be in the public domain in the United States (e.g. pre-1929 US
 * releases whose copyright lapsed). That flag is metadata about the *film*, not
 * a download permission — the Internet Archive adapter still checks the item's
 * own rights fields before it will report a permitted download.
 */

export interface FixtureTitle {
  tmdbId: number;
  kind: 'movie' | 'tv';
  title: string;
  originalTitle?: string;
  year: number;
  overview: string;
  runtimeMinutes?: number;
  genres: string[];
  voteAverage: number;
  voteCount: number;
  cast: { id: number; name: string; character?: string }[];
  directors?: string[];
  seasons?: { seasonNumber: number; name: string; episodeCount: number; airDate?: string }[];
  publicDomain?: boolean;
}

export const FIXTURE_ATTRIBUTION =
  'Offline sample catalogue bundled with BlaxkVault. No TMDB API key is configured, so no live metadata was requested.';

export const FIXTURE_TITLES: FixtureTitle[] = [
  {
    tmdbId: 900001,
    kind: 'movie',
    title: 'Night of the Living Dead',
    year: 1968,
    overview:
      'A group of strangers barricade themselves in a Pennsylvania farmhouse as the recently dead rise and attack the living. George A. Romero\'s debut redefined what a horror film could be on a budget of roughly $114,000.',
    runtimeMinutes: 96,
    genres: ['Horror', 'Thriller'],
    voteAverage: 7.6,
    voteCount: 1520,
    cast: [
      { id: 900101, name: 'Duane Jones', character: 'Ben' },
      { id: 900102, name: 'Judith O\'Dea', character: 'Barbra' },
      { id: 900103, name: 'Karl Hardman', character: 'Harry Cooper' },
      { id: 900104, name: 'Marilyn Eastman', character: 'Helen Cooper' },
    ],
    directors: ['George A. Romero'],
    publicDomain: true,
  },
  {
    tmdbId: 900002,
    kind: 'movie',
    title: 'Nosferatu',
    originalTitle: 'Nosferatu, eine Symphonie des Grauens',
    year: 1922,
    overview:
      'F. W. Murnau\'s unauthorised adaptation of Dracula follows estate agent Hutter to the Carpathian castle of Count Orlok, whose shadow precedes a plague into the town of Wisborg.',
    runtimeMinutes: 94,
    genres: ['Horror', 'Fantasy', 'Silent'],
    voteAverage: 7.8,
    voteCount: 1180,
    cast: [
      { id: 900201, name: 'Max Schreck', character: 'Count Orlok' },
      { id: 900202, name: 'Gustav von Wangenheim', character: 'Hutter' },
      { id: 900203, name: 'Greta Schröder', character: 'Ellen Hutter' },
    ],
    directors: ['F. W. Murnau'],
    publicDomain: true,
  },
  {
    tmdbId: 900003,
    kind: 'movie',
    title: 'The Cabinet of Dr. Caligari',
    originalTitle: 'Das Cabinet des Dr. Caligari',
    year: 1920,
    overview:
      'A hypnotist uses a sleepwalker to commit murders in a German town, told through the skewed painted sets that made German Expressionism famous.',
    runtimeMinutes: 77,
    genres: ['Horror', 'Thriller', 'Silent'],
    voteAverage: 7.6,
    voteCount: 940,
    cast: [
      { id: 900301, name: 'Werner Krauss', character: 'Dr. Caligari' },
      { id: 900302, name: 'Conrad Veidt', character: 'Cesare' },
      { id: 900303, name: 'Lil Dagover', character: 'Jane Olsen' },
    ],
    directors: ['Robert Wiene'],
    publicDomain: true,
  },
  {
    tmdbId: 900004,
    kind: 'movie',
    title: 'Metropolis',
    year: 1927,
    overview:
      'In a future city divided between planners above and workers below, a young industrialist and a prophetic woman try to bridge the two worlds. Fritz Lang\'s restoration remains the reference point for science-fiction production design.',
    runtimeMinutes: 153,
    genres: ['Science Fiction', 'Drama', 'Silent'],
    voteAverage: 8.1,
    voteCount: 1640,
    cast: [
      { id: 900401, name: 'Brigitte Helm', character: 'Maria / The Machine Man' },
      { id: 900402, name: 'Gustav Fröhlich', character: 'Freder Fredersen' },
      { id: 900403, name: 'Alfred Abel', character: 'Joh Fredersen' },
    ],
    directors: ['Fritz Lang'],
    publicDomain: true,
  },
  {
    tmdbId: 900005,
    kind: 'movie',
    title: 'The General',
    year: 1926,
    overview:
      'Buster Keaton plays a Confederate engineer who single-handedly pursues his stolen locomotive. The stunt work is real, filmed with real trains and no doubles.',
    runtimeMinutes: 78,
    genres: ['Comedy', 'Action', 'Silent'],
    voteAverage: 7.9,
    voteCount: 860,
    cast: [
      { id: 900501, name: 'Buster Keaton', character: 'Johnnie Gray' },
      { id: 900502, name: 'Marion Mack', character: 'Annabelle Lee' },
    ],
    directors: ['Buster Keaton', 'Clyde Bruckman'],
    publicDomain: true,
  },
  {
    tmdbId: 900006,
    kind: 'movie',
    title: 'His Girl Friday',
    year: 1940,
    overview:
      'A newspaper editor does everything he can to stop his star reporter and ex-wife from remarrying, in a comedy built on overlapping dialogue delivered at record speed.',
    runtimeMinutes: 92,
    genres: ['Comedy', 'Romance', 'Drama'],
    voteAverage: 7.6,
    voteCount: 640,
    cast: [
      { id: 900601, name: 'Cary Grant', character: 'Walter Burns' },
      { id: 900602, name: 'Rosalind Russell', character: 'Hildy Johnson' },
      { id: 900603, name: 'Ralph Bellamy', character: 'Bruce Baldwin' },
    ],
    directors: ['Howard Hawks'],
    publicDomain: true,
  },
  {
    tmdbId: 900007,
    kind: 'movie',
    title: 'Plan 9 from Outer Space',
    year: 1957,
    overview:
      'Aliens resurrect the dead to stop humanity from destroying the universe. Ed Wood\'s enthusiasm outruns his budget by a wide margin, and the film became the most famous "so bad it\'s essential" artefact in cinema.',
    runtimeMinutes: 79,
    genres: ['Science Fiction', 'Horror'],
    voteAverage: 4.1,
    voteCount: 520,
    cast: [
      { id: 900701, name: 'Bela Lugosi', character: 'The Ghoul Man' },
      { id: 900702, name: 'Tor Johnson', character: 'Inspector Clay' },
      { id: 900703, name: 'Vampira', character: 'Vampire Girl' },
    ],
    directors: ['Edward D. Wood Jr.'],
    publicDomain: true,
  },
  {
    tmdbId: 900008,
    kind: 'movie',
    title: 'Charade',
    year: 1963,
    overview:
      'A widow in Paris discovers her late husband stole a fortune, and everyone around her wants it. A romantic thriller that keeps changing which of its leads is dangerous.',
    runtimeMinutes: 113,
    genres: ['Thriller', 'Romance', 'Comedy'],
    voteAverage: 7.7,
    voteCount: 780,
    cast: [
      { id: 900801, name: 'Cary Grant', character: 'Peter Joshua' },
      { id: 900802, name: 'Audrey Hepburn', character: 'Regina Lampert' },
      { id: 900803, name: 'Walter Matthau', character: 'Hamilton Bartholomew' },
    ],
    directors: ['Stanley Donen'],
    publicDomain: true,
  },
  {
    tmdbId: 900009,
    kind: 'movie',
    title: 'Carnival of Souls',
    year: 1962,
    overview:
      'After surviving a drag race that killed her friends, a church organist takes a job in a new town and is drawn to an abandoned lakeside pavilion. Shot for around $33,000 in Kansas, it has outlived most films of its year.',
    runtimeMinutes: 78,
    genres: ['Horror', 'Mystery'],
    voteAverage: 7.0,
    voteCount: 410,
    cast: [
      { id: 900901, name: 'Candace Hilligoss', character: 'Mary Henry' },
      { id: 900902, name: 'Frances Feist', character: 'Mrs. Thomas' },
      { id: 900903, name: 'Sidney Berger', character: 'John Linden' },
    ],
    directors: ['Herk Harvey'],
    publicDomain: true,
  },
  {
    tmdbId: 900010,
    kind: 'movie',
    title: 'Battleship Potemkin',
    originalTitle: 'Броненосец Потёмкин',
    year: 1925,
    overview:
      'Sergei Eisenstein dramatises the 1905 mutiny aboard the battleship Potemkin. The Odessa Steps sequence remains the most studied passage of editing in film history.',
    runtimeMinutes: 75,
    genres: ['Drama', 'History', 'Silent'],
    voteAverage: 7.7,
    voteCount: 690,
    cast: [
      { id: 901001, name: 'Aleksandr Antonov', character: 'Grigory Vakulinchuk' },
      { id: 901002, name: 'Vladimir Barsky', character: 'Commander Golikov' },
    ],
    directors: ['Sergei Eisenstein'],
    publicDomain: true,
  },
  {
    tmdbId: 900011,
    kind: 'tv',
    title: 'The Beverly Hillbillies',
    year: 1962,
    overview:
      'A rural family strikes oil and moves to an upscale California neighbourhood, to the mutual bewilderment of everyone involved. A case study in 1960s network sitcom pacing.',
    genres: ['Comedy'],
    voteAverage: 6.6,
    voteCount: 180,
    cast: [
      { id: 901101, name: 'Buddy Ebsen', character: 'Jed Clampett' },
      { id: 901102, name: 'Irene Ryan', character: 'Granny' },
      { id: 901103, name: 'Donna Douglas', character: 'Elly May Clampett' },
    ],
    seasons: [
      { seasonNumber: 1, name: 'Season 1', episodeCount: 36, airDate: '1962-09-26' },
      { seasonNumber: 2, name: 'Season 2', episodeCount: 36, airDate: '1963-09-25' },
    ],
  },
  {
    tmdbId: 900012,
    kind: 'tv',
    title: 'The Adventures of Sherlock Holmes',
    year: 1954,
    overview:
      'A 1954 American television adaptation of Arthur Conan Doyle\'s stories, with Ronald Howard as Holmes and Howard Marion-Crawford as Watson. The source stories are long out of copyright.',
    genres: ['Crime', 'Mystery', 'Drama'],
    voteAverage: 7.1,
    voteCount: 96,
    cast: [
      { id: 901201, name: 'Ronald Howard', character: 'Sherlock Holmes' },
      { id: 901202, name: 'Howard Marion-Crawford', character: 'Dr. Watson' },
    ],
    seasons: [{ seasonNumber: 1, name: 'Season 1', episodeCount: 39, airDate: '1954-10-18' }],
  },
];

/** A handful of concrete episodes so the series screen has real structure offline. */
export const FIXTURE_EPISODES: Record<string, { seasonNumber: number; episodeNumber: number; name: string; overview: string; runtimeMinutes: number; airDate: string }[]> = {
  '900011': [
    { seasonNumber: 1, episodeNumber: 1, name: 'The Clampetts Strike Oil', overview: 'Jed discovers oil on his land and is offered a fortune for the rights.', runtimeMinutes: 25, airDate: '1962-09-26' },
    { seasonNumber: 1, episodeNumber: 2, name: 'Getting Settled', overview: 'The family arrives in Beverly Hills and tries to make sense of their new mansion.', runtimeMinutes: 25, airDate: '1962-10-03' },
    { seasonNumber: 1, episodeNumber: 3, name: 'Meanwhile, Back at the Cabin', overview: 'Granny refuses to accept that the move is permanent.', runtimeMinutes: 25, airDate: '1962-10-10' },
    { seasonNumber: 1, episodeNumber: 4, name: 'The Clampetts Meet Mrs. Drysdale', overview: 'The Drysdales meet their new neighbours for the first time.', runtimeMinutes: 25, airDate: '1962-10-17' },
  ],
  '900012': [
    { seasonNumber: 1, episodeNumber: 1, name: 'The Case of the Cunningham Heritage', overview: 'Holmes takes on the case that introduces him to Dr. Watson.', runtimeMinutes: 26, airDate: '1954-10-18' },
    { seasonNumber: 1, episodeNumber: 2, name: 'The Case of Lady Beryl', overview: 'A confession appears to close a case before it is properly opened.', runtimeMinutes: 26, airDate: '1954-10-25' },
    { seasonNumber: 1, episodeNumber: 3, name: 'The Case of the Pennsylvania Gun', overview: 'A duelling pistol and a disputed estate draw Holmes away from London.', runtimeMinutes: 26, airDate: '1954-11-01' },
  ],
};

export function findFixtureTitle(tmdbId: number): FixtureTitle | undefined {
  return FIXTURE_TITLES.find((t) => t.tmdbId === tmdbId);
}

/** Deterministic substring search over the fixture, mirroring TMDB semantics. */
export function searchFixture(query: string, kind: 'movie' | 'tv' | 'multi' = 'multi'): FixtureTitle[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return FIXTURE_TITLES.filter((t) => {
    if (kind !== 'multi' && t.kind !== kind) return false;
    return (
      t.title.toLowerCase().includes(needle) ||
      (t.originalTitle ?? '').toLowerCase().includes(needle) ||
      (t.directors ?? []).join(' ').toLowerCase().includes(needle) ||
      t.genres.join(' ').toLowerCase().includes(needle)
    );
  });
}

export function fixtureTrending(): FixtureTitle[] {
  return [...FIXTURE_TITLES].sort((a, b) => b.voteAverage - a.voteAverage).slice(0, 10);
}
