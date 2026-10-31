/**
 * Source registry + inspection.
 *
 * GET  /api/sources          → what each adapter can and cannot do, and whether
 *                              it is configured (never the credential itself).
 * POST /api/sources/inspect  → run a real inspection of a URL or archive item
 *                              and return the honest verdict.
 */
import type { FastifyInstance } from 'fastify';
import { archiveSearchSchema, inspectRequestSchema } from '@blaxkvault/shared';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { describeAdapters, getAdapter } from '../adapters/index.js';
import { getArchiveItem, searchArchiveMovies } from '../adapters/archive.js';

export async function registerSourceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sources', async () => {
    return {
      sources: describeAdapters(),
      note: 'A metadata source is not a download source. BlaxkVault inspects every candidate and reports available / unavailable / unsupported / unknown rather than assuming.',
    };
  });

  app.post('/api/sources/inspect', async (request) => {
    const parsed = inspectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError('VALIDATION_ERROR', 'Inspection needs an http(s) URL.', parsed.error.flatten());
    }
    const { url, sourceId, context } = parsed.data;

    // Route archive.org URLs to the archive adapter, everything else to the
    // direct-URL adapter, unless the caller pinned a specific source.
    const chosenId = sourceId ?? (/\/\/(www\.)?archive\.org\//i.test(url) ? 'internet-archive' : 'direct-url');
    const adapter = getAdapter(chosenId);
    if (!adapter) throw notFound(`No source adapter is registered as "${chosenId}".`);
    if (!adapter.inspect) {
      throw badRequest(`The "${adapter.label}" source provides ${adapter.capabilities.join(', ')} only — it has no inspection capability.`);
    }
    if (!adapter.enabled()) {
      throw new AppError('ENGINE_UNAVAILABLE', `The "${adapter.label}" source is not configured on this server.`);
    }

    const inspection = await adapter.inspect(url, context ?? {});
    return { inspection, adapter: { id: adapter.id, label: adapter.label } };
  });

  /* Internet Archive item browsing — real items, real rights fields. */
  app.get('/api/archive/search', async (request) => {
    const parsed = archiveSearchSchema.safeParse(request.query);
    if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'Provide a search term of 1–120 characters.');
    const items = await searchArchiveMovies(parsed.data.q, parsed.data.page);
    return {
      query: parsed.data.q,
      page: parsed.data.page,
      results: items,
      attribution: 'Search results from Internet Archive (archive.org/advancedsearch.php).',
      note: 'Each result shows whether the item itself states an open licence or public-domain status. Items without a rights statement cannot be queued.',
    };
  });

  app.get<{ Params: { identifier: string } }>('/api/archive/items/:identifier', async (request) => {
    if (!/^[A-Za-z0-9._-]{1,120}$/.test(request.params.identifier)) throw badRequest('That archive.org identifier is malformed.');
    return getArchiveItem(request.params.identifier);
  });
}
