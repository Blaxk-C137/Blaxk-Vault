/**
 * Discovery routes: search, title details, seasons/episodes, availability and
 * downloadability. Metadata (what it is), availability (where to watch) and
 * downloadability (is there a permitted file) are three separate responses on
 * purpose — the UI can never accidentally present one as another.
 */
import type { FastifyInstance } from 'fastify';
import { searchQuerySchema, type SearchResponse, type TitleDetail, type Episode, type TrendingResponse, type TitleAvailability, type DownloadabilityAssessment } from '@blaxkvault/shared';
import { AppError, badRequest } from '../lib/errors.js';
import { getSeasonEpisodes, getTitleDetail, parseTitleId, searchTitles, trending } from '../adapters/tmdb.js';
import { assessDownloadability, assessEpisodeDownloadability } from '../adapters/index.js';
import { findLocalCopies } from '../services/library.js';
import { getAvailability } from '../adapters/watchmode.js';
import { effectiveRegions } from '../services/settings.js';
import { z } from 'zod';

const episodeDownloadSchema = z.object({
  seriesTitle: z.string().min(1).max(300),
  seasonNumber: z.number().int().min(0).max(200),
  episodeNumber: z.number().int().min(0).max(5000),
});

export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/search', async (request): Promise<SearchResponse> => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Search needs a query of 1–120 characters.', parsed.error.flatten());
    const { q, page, kind } = parsed.data;
    const started = Date.now();
    const result = await searchTitles(q, kind, page);
    return { query: q, provider: 'tmdb', ...result, tookMs: Date.now() - started };
  });

  app.get('/api/trending', async (): Promise<TrendingResponse> => {
    return trending();
  });

  app.get<{ Params: { id: string } }>('/api/titles/:id', async (request): Promise<TitleDetail> => {
    const parsed = parseTitleId(request.params.id);
    if (!parsed) throw badRequest('Title ids look like "tmdb:movie:603". That id could not be parsed.');
    return getTitleDetail(parsed.kind, parsed.tmdbId);
  });

  app.get<{ Params: { id: string } }>('/api/titles/:id/seasons', async (request) => {
    const parsed = parseTitleId(request.params.id);
    if (!parsed) throw badRequest('That title id could not be parsed.');
    if (parsed.kind !== 'tv') throw new AppError('BAD_REQUEST', 'Only series have seasons.');
    const detail = await getTitleDetail('tv', parsed.tmdbId);
    return { seasons: detail.seasons ?? [], attribution: detail.attribution };
  });

  app.get<{ Params: { id: string; season: string } }>('/api/titles/:id/season/:season', async (request): Promise<{ episodes: Episode[]; seasonNumber: number }> => {
    const parsed = parseTitleId(request.params.id);
    if (!parsed) throw badRequest('That title id could not be parsed.');
    if (parsed.kind !== 'tv') throw new AppError('BAD_REQUEST', 'Only series have episodes.');
    const seasonNumber = Number.parseInt(request.params.season, 10);
    if (!Number.isInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 200) throw badRequest('Season numbers must be between 0 and 200.');
    const episodes = await getSeasonEpisodes(parsed.tmdbId, seasonNumber);
    return { seasonNumber, episodes };
  });

  app.get<{ Params: { id: string } }>('/api/titles/:id/availability', async (request): Promise<TitleAvailability> => {
    const parsed = parseTitleId(request.params.id);
    if (!parsed) throw badRequest('That title id could not be parsed.');
    const regions = effectiveRegions();
    return getAvailability(parsed.kind, parsed.tmdbId, regions.watchmode);
  });

  /**
   * Downloadability is checked live against the archive adapter: it searches for
   * the title, reads each candidate item's rights fields, and reports per-source
   * verdicts. It is deliberately slower than the metadata call — it does real work.
   */
  /**
   * Files this machine already holds for a title. Separate from
   * downloadability on purpose: owning a copy and being able to fetch one are
   * different facts, and the UI shows them as such.
   */
  app.get<{ Params: { id: string } }>('/api/titles/:id/local-copies', async (request) => {
    const parsed = parseTitleId(request.params.id);
    if (!parsed) throw badRequest('That title id could not be parsed.');
    const detail = await getTitleDetail(parsed.kind, parsed.tmdbId);
    const copies = findLocalCopies({ title: detail.title, year: detail.year, kind: detail.kind });
    return {
      copies,
      note:
        copies.length > 0
          ? `${copies.length} matching file${copies.length === 1 ? '' : 's'} already in your library.`
          : 'No file in your library matches this title. Matches require the same distinctive words and, when both are known, the same year.',
    };
  });

  app.get<{ Params: { id: string }; Querystring: { candidates?: string } }>('/api/titles/:id/downloadability', async (request): Promise<DownloadabilityAssessment> => {
    const parsed = parseTitleId(request.params.id);
    if (!parsed) throw badRequest('That title id could not be parsed.');
    const detail = await getTitleDetail(parsed.kind, parsed.tmdbId);
    const maxCandidates = Math.min(4, Math.max(1, Number.parseInt(request.query.candidates ?? '2', 10) || 2));
    return assessDownloadability(
      { kind: parsed.kind, tmdbId: parsed.tmdbId, title: detail.title, year: detail.year },
      { maxCandidates },
    );
  });

  app.post('/api/titles/episodes/downloadability', async (request): Promise<DownloadabilityAssessment> => {
    const parsed = episodeDownloadSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Episode checks need a series title, season number and episode number.');
    return assessEpisodeDownloadability(parsed.data);
  });
}
