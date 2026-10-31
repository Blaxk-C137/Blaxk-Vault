/**
 * Availability adapter — "where can this legally be watched?"
 *
 * Two providers behind one interface:
 *   1. Watchmode (https://www.watchmode.com/ — docs at https://api.watchmode.com/)
 *      when WATCHMODE_API_KEY is set. Validate pricing, quotas and regional
 *      coverage for your own account before relying on it: the free tier is
 *      limited and coverage for Nigeria (NG) must be confirmed against your key.
 *   2. TMDB's own region watch-provider data as a fallback when only a TMDB key
 *      is present (same region parameter, e.g. NG).
 *
 * Neither provider is a source of files. Every entry is a deep link to the
 * provider's own page. This adapter has no `inspect()` at all, which is the
 * point: it cannot be mistaken for a download source.
 */
import { config } from '../config.js';
import { log } from '../logger.js';
import { AppError, upstream } from '../lib/errors.js';
import type { AvailabilityType, MediaKind, TitleAvailability } from '@blaxkvault/shared';
import { TMDB_ATTRIBUTION, getWatchProviders, imageUrl } from './tmdb.js';
import type { SourceAdapter } from './types.js';

export const WATCHMODE_ATTRIBUTION = 'Streaming availability data from Watchmode (watchmode.com). Listings can change; verify on the provider page.';

const WATCHMODE_BASE = 'https://api.watchmode.com/v1';

interface WatchmodeSource {
  source_id?: number;
  name?: string;
  type?: string;
  region?: string;
  web_url?: string;
  format?: string;
  price?: number;
  seasons?: number;
  episodes?: number;
}

function mapWatchmodeType(type?: string): AvailabilityType {
  switch ((type ?? '').toLowerCase()) {
    case 'sub':
    case 'subscription':
      return 'stream';
    case 'rent':
      return 'rent';
    case 'buy':
      return 'buy';
    case 'free':
      return 'free';
    case 'tve':
    case 'ads':
      return 'ads';
    default:
      return 'unknown';
  }
}

async function watchmodeSources(kind: MediaKind, tmdbId: number, region: string): Promise<WatchmodeSource[]> {
  const apiKey = config.watchmode.apiKey;
  if (!apiKey) throw new AppError('ENGINE_UNAVAILABLE', 'No Watchmode API key configured.');
  const id = `${kind === 'movie' ? 'movie' : 'tv'}-${tmdbId}`;
  const url = `${WATCHMODE_BASE}/title/${id}/sources/?apiKey=${encodeURIComponent(apiKey)}&regions=${encodeURIComponent(region)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (response.status === 401 || response.status === 403) {
      throw new AppError('UPSTREAM_ERROR', 'Watchmode rejected the configured API key.');
    }
    if (response.status === 429) throw new AppError('RATE_LIMITED', 'Watchmode quota reached for this key.');
    if (response.status === 404) return [];
    if (!response.ok) throw upstream(`Watchmode responded ${response.status}.`);
    const body = (await response.json()) as WatchmodeSource[] | { results?: WatchmodeSource[] };
    return Array.isArray(body) ? body : body.results ?? [];
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw upstream('Watchmode did not respond in time.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const LOGO_BASE = 'https://cdn.watchmode.com/provider_logos';

export async function getAvailability(kind: MediaKind, tmdbId: number, regionOverride?: string): Promise<TitleAvailability> {
  const region = (regionOverride ?? config.watchmode.region ?? config.tmdb.region).toUpperCase();
  const fetchedAt = new Date().toISOString();

  if (config.watchmode.apiKey) {
    try {
      const sources = await watchmodeSources(kind, tmdbId, region);
      const providers = sources
        .filter((s) => s.name && s.region?.toUpperCase() === region)
        .map((s) => ({
          providerId: s.source_id ?? 0,
          name: s.name!,
          logoUrl: s.source_id ? `${LOGO_BASE}/provider_${s.source_id}.png` : undefined,
          type: mapWatchmodeType(s.type),
          region,
          linkUrl: s.web_url ?? '',
          priceSummary:
            typeof s.price === 'number' && s.price > 0
              ? `${s.price.toFixed(2)} ${s.type?.toLowerCase() === 'rent' ? '(rental)' : s.type?.toLowerCase() === 'buy' ? '(purchase)' : ''}`.trim()
              : undefined,
          quality: s.format,
        }))
        .filter((p) => p.linkUrl);
      return {
        tmdbId,
        kind,
        region,
        providers,
        source: 'watchmode',
        fetchedAt,
        attribution: WATCHMODE_ATTRIBUTION,
        note:
          providers.length === 0
            ? `Watchmode returned no listings for this title in ${region}. That is a statement about listings, not about whether the film exists or can be downloaded.`
            : `Listings for ${region} via Watchmode. Each link opens the provider's own page.`,
      };
    } catch (err) {
      log.warn('watchmode.unavailable', { message: (err as Error).message });
      // fall through to TMDB data rather than failing the whole screen
    }
  }

  const tmdbProviders = await getWatchProviders(kind, tmdbId, config.tmdb.region).catch(() => null);
  if (tmdbProviders) {
    const { buckets } = tmdbProviders;
    const push = (type: AvailabilityType, list?: { provider_id: number; provider_name: string; logo_path?: string; price?: { amount: number; currency: string } }[]) =>
      (list ?? []).map((p) => ({
        providerId: p.provider_id,
        name: p.provider_name,
        logoUrl: imageUrl(p.logo_path, 'w200'),
        type,
        region: tmdbProviders.region,
        linkUrl: buckets.link ?? '',
        priceSummary: p.price ? `${p.price.amount.toFixed(2)} ${p.price.currency}` : undefined,
      }));

    const providers = [
      ...push('stream', buckets.flatrate),
      ...push('free', buckets.free),
      ...push('ads', buckets.ads),
      ...push('rent', buckets.rent),
      ...push('buy', buckets.buy),
    ].filter((p) => p.linkUrl);

    return {
      tmdbId,
      kind,
      region: tmdbProviders.region,
      linkUrl: buckets.link,
      providers,
      source: 'tmdb',
      fetchedAt,
      attribution: `${TMDB_ATTRIBUTION} Availability data supplied by JustWatch through TMDB.`,
      note:
        providers.length === 0
          ? `TMDB returned no watch listings for ${tmdbProviders.region}. Add WATCHMODE_API_KEY for broader coverage.`
          : `Listings for ${tmdbProviders.region} via TMDB/JustWatch. These are viewing options, never files.`,
    };
  }

  return {
    tmdbId,
    kind,
    region,
    providers: [],
    source: 'mock',
    fetchedAt,
    attribution: 'No availability provider is configured.',
    note:
      'Where-to-watch data needs a key. Set WATCHMODE_API_KEY (watchmode.com) or TMDB_API_KEY to populate this section. BlaxkVault will not invent provider listings — an empty list here means "not checked", not "unavailable".',
  };
}

export function createWatchmodeAdapter(): SourceAdapter {
  return {
    id: 'watchmode',
    label: 'Watchmode',
    capabilities: ['availability'],
    docsUrl: 'https://api.watchmode.com/',
    description:
      'Streaming, rental and purchase listings by region. Watchmode (or TMDB\'s JustWatch data as a fallback) tells you where a title can be watched; it never provides a file and it cannot be downloaded from. Verify pricing, quota and Nigeria coverage before depending on it in production.',
    requiresKey: 'WATCHMODE_API_KEY',
    attribution: WATCHMODE_ATTRIBUTION,
    enabled: () => Boolean(config.watchmode.apiKey || config.tmdb.apiKey),
  };
}
