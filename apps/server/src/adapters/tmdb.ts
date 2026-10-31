/**
 * TMDB adapter — DISCOVERY ONLY.
 *
 * TMDB hosts no video files. Nothing here can produce a `fileUrl`; the adapter
 * declares only the `metadata` capability and its `inspect()` deliberately
 * returns an explicit "unsupported" verdict so the UI can honestly tell the
 * user that a metadata provider is not a download source.
 *
 * Docs: https://developer.themoviedb.org/docs
 * Terms: attribution required ("This product uses the TMDB API but is not
 * endorsed or certified by TMDB.") and the logo must not be altered.
 * The API key is read server-side from TMDB_API_KEY and never sent to the client.
 */
import { config } from '../config.js';
import { log } from '../logger.js';
import { AppError, upstream } from '../lib/errors.js';
import type {
  CastMember,
  CrewMember,
  DownloadInspection,
  Episode,
  Genre,
  MediaKind,
  SeasonSummary,
  TitleDetail,
  TitleSummary,
} from '@blaxkvault/shared';
import { FIXTURE_ATTRIBUTION, FIXTURE_EPISODES, FIXTURE_TITLES, fixtureTrending, findFixtureTitle, searchFixture } from './tmdb-fixtures.js';
import type { InspectionContext, SourceAdapter } from './types.js';

export const TMDB_ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

const API_BASE = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

export type PosterSize = 'w200' | 'w342' | 'w500' | 'w780' | 'original';
export type BackdropSize = 'w780' | 'w1280' | 'original';

export function imageUrl(path: string | null | undefined, size: PosterSize | BackdropSize = 'w500'): string | undefined {
  if (!path) return undefined;
  return `${IMAGE_BASE}/${size}${path.startsWith('/') ? path : `/${path}`}`;
}

/* ------------------------------- cache ---------------------------------- */

interface CacheEntry<T> {
  expires: number;
  value: T;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_MAX_ENTRIES = 500;

function cacheGet<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T, ttlSeconds = config.tmdb.cacheTtlSeconds): void {
  if (ttlSeconds <= 0) return;
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expires: Date.now() + ttlSeconds * 1000, value });
}

/* ------------------------------ transport -------------------------------- */

interface TmdbError {
  status_code?: number;
  status_message?: string;
}

async function tmdbFetch<T>(pathname: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const apiKey = config.tmdb.apiKey;
  if (!apiKey) throw new AppError('ENGINE_UNAVAILABLE', 'No TMDB API key is configured.');

  const url = new URL(`${API_BASE}${pathname}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    // Key travels in a header, not the query string, so it cannot leak into logs.
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401 && apiKey.length === 32) {
      // The v3 key form must go in the query string instead of the header.
      response = await fetch(`${url.toString()}&api_key=${encodeURIComponent(apiKey)}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    }
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') throw upstream('TMDB request timed out.');
    throw upstream(`Could not reach TMDB: ${(err as Error).message}`);
  }
  clearTimeout(timer);

  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') ?? 'a few';
    throw new AppError('RATE_LIMITED', `TMDB rate limit reached. Try again in ${retryAfter} seconds.`);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as TmdbError;
      detail = body.status_message ?? '';
    } catch {
      /* non-JSON error body */
    }
    if (response.status === 401) {
      throw new AppError('UPSTREAM_ERROR', 'TMDB rejected the configured API key (401). Check TMDB_API_KEY.');
    }
    throw upstream(`TMDB responded ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await response.json()) as T;
}

function cached<T>(key: string, loader: () => Promise<T>, ttl = config.tmdb.cacheTtlSeconds): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return loader().then((value) => {
    cacheSet(key, value, ttl);
    return value;
  });
}

/* ------------------------------- mapping --------------------------------- */

export function parseTitleId(id: string): { kind: MediaKind; tmdbId: number } | null {
  const match = /^tmdb:(movie|tv):(\d+)$/.exec(id);
  if (!match) return null;
  return { kind: match[1] as MediaKind, tmdbId: Number.parseInt(match[2]!, 10) };
}

export function titleId(kind: MediaKind, tmdbId: number): string {
  return `tmdb:${kind}:${tmdbId}`;
}

interface RawSearchItem {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  genre_ids?: number[];
  release_date?: string;
  first_air_date?: string;
}

function yearOf(date?: string): number | undefined {
  if (!date) return undefined;
  const year = Number.parseInt(date.slice(0, 4), 10);
  return Number.isFinite(year) ? year : undefined;
}

function mapSearchItem(item: RawSearchItem, kind: MediaKind): TitleSummary {
  return {
    id: titleId(kind, item.id),
    provider: 'tmdb',
    tmdbId: item.id,
    kind,
    title: item.title ?? item.name ?? 'Untitled',
    originalTitle: item.original_title ?? item.original_name,
    year: yearOf(item.release_date ?? item.first_air_date),
    overview: item.overview,
    posterUrl: imageUrl(item.poster_path, 'w342'),
    backdropUrl: imageUrl(item.backdrop_path, 'w780'),
    voteAverage: item.vote_average,
    voteCount: item.vote_count,
    popularity: item.popularity,
    genreIds: item.genre_ids,
  };
}

const GENRE_NAMES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime', 99: 'Documentary',
  18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller',
  10752: 'War', 37: 'Western', 10759: 'Action & Adventure', 10762: 'Kids', 10763: 'News',
  10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap', 10767: 'Talk', 10768: 'War & Politics',
};

export function genreName(id: number): string {
  return GENRE_NAMES[id] ?? 'Unknown';
}

/* ------------------------------- fixtures -------------------------------- */

function fixtureToSummary(t: (typeof FIXTURE_TITLES)[number]): TitleSummary {
  return {
    id: titleId(t.kind, t.tmdbId),
    provider: 'tmdb',
    tmdbId: t.tmdbId,
    kind: t.kind,
    title: t.title,
    originalTitle: t.originalTitle,
    year: t.year,
    overview: t.overview,
    voteAverage: t.voteAverage,
    voteCount: t.voteCount,
    genreIds: t.genres.map((_, i) => i + 1),
  };
}

function fixtureDetail(t: (typeof FIXTURE_TITLES)[number]): TitleDetail {
  const genres: Genre[] = t.genres.map((name, index) => ({ id: index + 1, name }));
  const cast: CastMember[] = t.cast.map((c, index) => ({ id: c.id, name: c.name, character: c.character, order: index }));
  const crew: CrewMember[] = (t.directors ?? []).map((name, index) => ({ id: 800000 + index, name, job: 'Director' }));
  const seasons: SeasonSummary[] | undefined = t.seasons?.map((s) => ({
    seasonNumber: s.seasonNumber,
    name: s.name,
    episodeCount: s.episodeCount,
    airDate: s.airDate,
  }));
  return {
    ...fixtureToSummary(t),
    genres,
    cast,
    crew,
    seasons,
    runtimeMinutes: t.runtimeMinutes,
    releaseDate: String(t.year),
    status: 'Released',
    attribution: FIXTURE_ATTRIBUTION,
    imdbId: undefined,
  };
}

/* ------------------------------ public API -------------------------------- */

export interface NormalizedSearchResult {
  page: number;
  totalPages: number;
  totalResults: number;
  results: TitleSummary[];
  mock: boolean;
  attribution: string;
}

export async function searchTitles(
  query: string,
  kind: MediaKind | 'multi' = 'multi',
  page = 1,
): Promise<NormalizedSearchResult> {
  const started = Date.now();
  if (!config.tmdb.apiKey) {
    const hits = searchFixture(query, kind);
    return {
      page: 1,
      totalPages: 1,
      totalResults: hits.length,
      results: hits.map(fixtureToSummary),
      mock: true,
      attribution: FIXTURE_ATTRIBUTION,
    };
  }

  const pathname = kind === 'multi' ? '/search/multi' : `/search/${kind}`;
  const raw = await cached(
    `search:${kind}:${query}:${page}`,
    () =>
      tmdbFetch<{ page: number; total_pages: number; total_results: number; results: RawSearchItem[] }>(pathname, {
        query,
        page,
        include_adult: false,
        language: config.tmdb.language,
      }),
    300,
  );

  const results = raw.results
    .map((item) => {
      const itemKind: MediaKind | undefined =
        kind === 'multi' ? (item.media_type === 'tv' ? 'tv' : item.media_type === 'movie' ? 'movie' : undefined) : kind;
      if (!itemKind) return undefined;
      if (!item.title && !item.name) return undefined;
      return mapSearchItem(item, itemKind);
    })
    .filter((r): r is TitleSummary => Boolean(r));

  log.debug('tmdb.search', { query, kind, page, results: results.length, ms: Date.now() - started });
  return {
    page: raw.page,
    totalPages: Math.min(raw.total_pages, 500),
    totalResults: raw.total_results,
    results,
    mock: false,
    attribution: TMDB_ATTRIBUTION,
  };
}

export async function trending(): Promise<{ results: TitleSummary[]; mock: boolean; attribution: string }> {
  if (!config.tmdb.apiKey) {
    return { results: fixtureTrending().map(fixtureToSummary), mock: true, attribution: FIXTURE_ATTRIBUTION };
  }
  const raw = await cached(
    'trending:all:week',
    () =>
      tmdbFetch<{ results: RawSearchItem[] }>('/trending/all/week', { language: config.tmdb.language }),
    900,
  );
  const results = raw.results
    .filter((i) => i.media_type === 'movie' || i.media_type === 'tv')
    .map((i) => mapSearchItem(i, i.media_type === 'tv' ? 'tv' : 'movie'));
  return { results, mock: false, attribution: TMDB_ATTRIBUTION };
}

interface RawDetail extends RawSearchItem {
  tagline?: string;
  status?: string;
  runtime?: number;
  episode_run_time?: number[];
  release_date?: string;
  first_air_date?: string;
  homepage?: string;
  imdb_id?: string;
  external_ids?: { imdb_id?: string };
  genres?: { id: number; name: string }[];
  credits?: {
    cast?: { id: number; name: string; character?: string; profile_path?: string | null; order?: number }[];
    crew?: { id: number; name: string; job?: string; profile_path?: string | null }[];
  };
  seasons?: { season_number: number; name: string; overview?: string; episode_count: number; air_date?: string | null; poster_path?: string | null }[];
  number_of_seasons?: number;
}

export async function getTitleDetail(kind: MediaKind, tmdbId: number): Promise<TitleDetail> {
  if (!config.tmdb.apiKey) {
    const fixture = findFixtureTitle(tmdbId);
    if (fixture) return fixtureDetail(fixture);
    throw new AppError('NOT_FOUND', 'That title is not in the offline sample catalogue.');
  }

  const raw = await cached(
    `detail:${kind}:${tmdbId}`,
    () =>
      tmdbFetch<RawDetail>(`/${kind}/${tmdbId}`, {
        language: config.tmdb.language,
        append_to_response: 'credits,external_ids',
      }),
    3600,
  );

  const genres: Genre[] = raw.genres ?? [];
  const cast: CastMember[] = (raw.credits?.cast ?? []).slice(0, 20).map((c, index) => ({
    id: c.id,
    name: c.name,
    character: c.character,
    profileUrl: imageUrl(c.profile_path, 'w200'),
    order: c.order ?? index,
  }));
  const crew: CrewMember[] = (raw.credits?.crew ?? [])
    .filter((c) => ['Director', 'Writer', 'Creator', 'Executive Producer'].includes(c.job ?? ''))
    .slice(0, 12)
    .map((c) => ({ id: c.id, name: c.name, job: c.job ?? 'Crew', profileUrl: imageUrl(c.profile_path, 'w200') }));

  const seasons: SeasonSummary[] | undefined = raw.seasons
    ?.filter((s) => s.season_number > 0)
    .map((s) => ({
      seasonNumber: s.season_number,
      name: s.name,
      overview: s.overview,
      episodeCount: s.episode_count,
      airDate: s.air_date ?? undefined,
      posterUrl: imageUrl(s.poster_path, 'w342'),
    }));

  return {
    id: titleId(kind, tmdbId),
    provider: 'tmdb',
    tmdbId,
    kind,
    title: raw.title ?? raw.name ?? 'Untitled',
    originalTitle: raw.original_title ?? raw.original_name,
    year: yearOf(raw.release_date ?? raw.first_air_date),
    overview: raw.overview,
    posterUrl: imageUrl(raw.poster_path, 'w500'),
    backdropUrl: imageUrl(raw.backdrop_path, 'w1280'),
    voteAverage: raw.vote_average,
    voteCount: raw.vote_count,
    popularity: raw.popularity,
    tagline: raw.tagline || undefined,
    status: raw.status,
    releaseDate: raw.release_date ?? raw.first_air_date,
    runtimeMinutes: raw.runtime ?? raw.episode_run_time?.[0],
    genres,
    cast,
    crew,
    seasons,
    imdbId: raw.imdb_id ?? raw.external_ids?.imdb_id,
    homepage: raw.homepage || undefined,
    attribution: TMDB_ATTRIBUTION,
  };
}

export async function getSeasonEpisodes(tmdbId: number, seasonNumber: number): Promise<Episode[]> {
  if (!config.tmdb.apiKey) {
    const episodes = FIXTURE_EPISODES[String(tmdbId)]?.filter((e) => e.seasonNumber === seasonNumber) ?? [];
    return episodes.map((e, index) => ({
      id: `fixture:${tmdbId}:${seasonNumber}:${e.episodeNumber}`,
      seasonNumber: e.seasonNumber,
      episodeNumber: e.episodeNumber,
      name: e.name,
      overview: e.overview,
      airDate: e.airDate,
      runtimeMinutes: e.runtimeMinutes,
      voteAverage: undefined,
      voteCount: undefined,
      stillUrl: undefined,
      downloadability: 'unknown',
      ...(index === Number.POSITIVE_INFINITY ? {} : {}),
    }));
  }

  const raw = await cached(
    `season:${tmdbId}:${seasonNumber}`,
    () =>
      tmdbFetch<{
        episodes?: {
          id: number;
          episode_number: number;
          season_number: number;
          name?: string;
          overview?: string;
          air_date?: string;
          runtime?: number;
          still_path?: string | null;
          vote_average?: number;
          vote_count?: number;
        }[];
      }>(`/tv/${tmdbId}/season/${seasonNumber}`, { language: config.tmdb.language }),
    3600,
  );

  return (raw.episodes ?? []).map((e) => ({
    id: `tmdb:episode:${e.id}`,
    seasonNumber: e.season_number,
    episodeNumber: e.episode_number,
    name: e.name ?? `Episode ${e.episode_number}`,
    overview: e.overview,
    airDate: e.air_date,
    runtimeMinutes: e.runtime,
    stillUrl: imageUrl(e.still_path, 'w500'),
    voteAverage: e.vote_average,
    voteCount: e.vote_count,
    downloadability: 'unknown' as const,
  }));
}

/* --------------------- region watch-provider listings --------------------- */

export interface RawProviderBucket {
  link?: string;
  flatrate?: { provider_id: number; provider_name: string; logo_path?: string }[];
  free?: { provider_id: number; provider_name: string; logo_path?: string }[];
  ads?: { provider_id: number; provider_name: string; logo_path?: string }[];
  rent?: { provider_id: number; provider_name: string; logo_path?: string; price?: { amount: number; currency: string } }[];
  buy?: { provider_id: number; provider_name: string; logo_path?: string; price?: { amount: number; currency: string } }[];
}

export async function getWatchProviders(
  kind: MediaKind,
  tmdbId: number,
  region: string,
): Promise<{ buckets: RawProviderBucket; region: string } | null> {
  if (!config.tmdb.apiKey) return null;
  const raw = await cached(
    `providers:${kind}:${tmdbId}:${region}`,
    () =>
      tmdbFetch<{ results?: Record<string, RawProviderBucket> }>(`/${kind}/${tmdbId}/watch/providers`, {}),
    6 * 3600,
  );
  const buckets = raw.results?.[region];
  if (!buckets) return null;
  return { buckets, region };
}

/* ------------------------- adapter implementation ------------------------- */

export function createTmdbAdapter(): SourceAdapter {
  return {
    id: 'tmdb',
    label: 'TMDB',
    capabilities: ['metadata'],
    docsUrl: 'https://developer.themoviedb.org/docs',
    description:
      'The Movie Database supplies titles, posters, backdrops, cast, seasons and episode lists. TMDB does not host, stream or license film files, so it can never deliver a download — it is here for discovery only.',
    requiresKey: 'TMDB_API_KEY',
    attribution: TMDB_ATTRIBUTION,
    enabled: () => Boolean(config.tmdb.apiKey),
    inspect: async (url: string, _ctx: InspectionContext): Promise<DownloadInspection> => ({
      status: 'unsupported',
      sourcePageUrl: url,
      inspectedBy: 'tmdb',
      inspectedAt: new Date().toISOString(),
      reason:
        'TMDB is a metadata catalogue. It contains no downloadable media, so a file cannot be produced from a TMDB entry. Use the Internet Archive source or your own authorised direct link instead.',
      rightsNote: 'Metadata only.',
    }),
  };
}

export { FIXTURE_ATTRIBUTION };
