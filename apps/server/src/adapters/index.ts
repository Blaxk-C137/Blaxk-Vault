/**
 * Adapter registry + the composite downloadability assessment.
 *
 * `assessDownloadability` is the single honest answer to the question the UI
 * asks on every detail screen: "is there a file I am permitted to download?"
 * It consults the archive adapter (the only shipped download source), inspects
 * the best candidate, and returns per-candidate verdicts. When nothing
 * qualifies it says so — with the reason — instead of offering a dead button.
 */
import type { DownloadCandidate, Downloadability, DownloadabilityAssessment, MediaKind, SourceAdapterDescriptor } from '@blaxkvault/shared';
import { titleAgreement } from '@blaxkvault/shared';
import { config } from '../config.js';
import { log } from '../logger.js';
import { getArchiveItem, searchArchiveMovies, type ArchiveSearchItem } from './archive.js';
import { createArchiveAdapter } from './archive.js';
import { createDirectUrlAdapter } from './direct-url.js';
import { createTmdbAdapter } from './tmdb.js';
import { createWatchmodeAdapter } from './watchmode.js';
import { describeAdapter, type SourceAdapter } from './types.js';

const ADAPTERS: SourceAdapter[] = [createTmdbAdapter(), createWatchmodeAdapter(), createArchiveAdapter(), createDirectUrlAdapter()];

export function listAdapters(): SourceAdapter[] {
  return ADAPTERS;
}

export function describeAdapters(): SourceAdapterDescriptor[] {
  return ADAPTERS.map(describeAdapter);
}

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/* --------------------- archive-backed downloadability --------------------- */

function normalizeTitleForSearch(title: string): string {
  return title.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Score an archive item as a candidate for a catalogue title.
 *
 * The agreement check comes first and is the deciding factor. Without it, the
 * matcher happily offered a Filipino exploitation film as "D.O.A. (1949)"
 * because the item's metadata happened to mention the phrase — a wrong file is
 * worse than a miss, so anything that does not agree on the title's distinctive
 * words is rejected outright.
 */
export function scoreArchiveCandidate(item: ArchiveSearchItem, title: string, year?: number): number {
  const agreement = titleAgreement(title, item.title);
  if (agreement < 0.6) return -100;

  let score = agreement * 50;

  if (year && item.year) {
    const delta = Math.abs(item.year - year);
    // A year mismatch on a title that already agrees is nearly always a
    // different cut, remake or unrelated scan of the same name.
    if (delta > 1) return -100;
    score += delta === 0 ? 25 : 15;
  } else if (year && !item.year) {
    score += 5; // unstated year is weak evidence either way, not a rejection
  }

  if (item.downloadCount) score += Math.min(15, Math.log10(item.downloadCount + 1) * 4);
  if (item.rightsPermitted) score += 20;
  return score;
}

export interface AssessInput {
  kind: MediaKind;
  tmdbId?: number;
  title: string;
  year?: number;
}

export interface AssessOptions {
  /** Candidate cap; each qualifying candidate costs one metadata request. */
  maxCandidates?: number;
}

export async function assessDownloadability(input: AssessInput, options: AssessOptions = {}): Promise<DownloadabilityAssessment> {
  const checkedAt = new Date().toISOString();
  const maxCandidates = options.maxCandidates ?? 2;
  const title = normalizeTitleForSearch(input.title);
  const candidates: DownloadCandidate[] = [];

  if (!title) {
    return {
      status: 'unknown',
      candidates,
      checkedAt,
      note: 'No title was supplied, so no download source could be checked.',
    };
  }

  let searchHits: ArchiveSearchItem[] = [];
  try {
    searchHits = await searchArchiveMovies(`title:("${title}")`, 1, 12);
    if (searchHits.length === 0 && input.year) {
      searchHits = await searchArchiveMovies(`("${title}")`, 1, 12);
    }
  } catch (err) {
    log.warn('archive.search.failed', { message: (err as Error).message });
    return {
      status: 'unknown',
      candidates,
      checkedAt,
      note: `The Internet Archive search could not be completed (${
        err instanceof Error ? err.message : 'unknown error'
      }). Downloadability is unverified; try again or paste a direct link you are authorised to use.`,
    };
  }

  const ranked = searchHits
    .map((item) => ({ item, score: scoreArchiveCandidate(item, title, input.year) }))
    .filter((r) => r.score > 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates);

  for (const { item } of ranked) {
    try {
      const detailed = await getArchiveItem(item.identifier);
      const best = detailed.bestFile;
      const status: Downloadability = detailed.rightsPermitted && best ? 'available' : best ? 'unknown' : 'unavailable';
      candidates.push({
        sourceId: 'internet-archive',
        sourceLabel: `Internet Archive · ${item.identifier}`,
        status,
        fileUrl: status === 'available' && best ? best.url : undefined,
        mimeType: best?.mimeType,
        sizeBytes: best?.sizeBytes,
        rightsNote: detailed.rightsNote,
        reason:
          status === 'available'
            ? undefined
            : best
              ? 'This item contains a file, but its rights are not stated as public domain or openly licensed, so BlaxkVault will not queue it. Read the rights on the item page.'
              : 'This item contains no supported media file.',
        sourcePageUrl: detailed.itemUrl,
        inspectedAt: checkedAt,
        probe: best
          ? {
              tool: 'container-sniff',
              container: best.name.split('.').pop()?.toLowerCase(),
              mimeType: best.mimeType,
              browserPlayable: ['mp4', 'm4v', 'webm', 'ogv'].includes(best.name.split('.').pop()?.toLowerCase() ?? ''),
              notes: [best.format ? `Archive format label: ${best.format}` : 'No format label provided by archive.org.'],
            }
          : undefined,
      });
    } catch (err) {
      log.debug('archive.item.failed', { identifier: item.identifier, message: (err as Error).message });
      candidates.push({
        sourceId: 'internet-archive',
        sourceLabel: `Internet Archive · ${item.identifier}`,
        status: 'unknown',
        reason: 'The item metadata could not be read, so its files and rights are unverified.',
        sourcePageUrl: item.itemUrl,
        inspectedAt: checkedAt,
      });
    }
  }

  const permittedCount = candidates.filter((c) => c.status === 'available').length;
  const status: Downloadability =
    permittedCount > 0 ? 'available' : candidates.length > 0 && candidates.every((c) => c.status === 'unavailable') ? 'unavailable' : 'unknown';

  return {
    status,
    candidates,
    checkedAt,
    note:
      permittedCount > 0
        ? `${permittedCount} permitted file${permittedCount === 1 ? '' : 's'} found on the Internet Archive. Check the rights note before you queue it.`
        : candidates.length > 0
          ? 'Archive.org has related items, but none with a verified open licence or public-domain status. BlaxkVault will not download those. If you hold your own authorised copy link, add it below.'
          : 'No freely licensed copy was found on the Internet Archive. BlaxkVault only queues files it can verify — add your own authorised direct link, or watch the title on a licensed service.',
  };
}

/** Per-episode check used by the series screen (lazy, on demand). */
export async function assessEpisodeDownloadability(input: {
  seriesTitle: string;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<DownloadabilityAssessment> {
  const code = `S${String(input.seasonNumber).padStart(2, '0')}E${String(input.episodeNumber).padStart(2, '0')}`;
  const title = normalizeTitleForSearch(input.seriesTitle);
  const checkedAt = new Date().toISOString();
  const candidates: DownloadCandidate[] = [];

  try {
    const hits = await searchArchiveMovies(`"${title}"`, 1, 12);
    const relevant = hits
      .filter((h) => titleAgreement(title, h.title) >= 0.6 && new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(h.title))
      .slice(0, 2);

    for (const hit of relevant) {
      const detailed = await getArchiveItem(hit.identifier);
      const best = detailed.bestFile;
      const status: Downloadability = detailed.rightsPermitted && best ? 'available' : best ? 'unknown' : 'unavailable';
      candidates.push({
        sourceId: 'internet-archive',
        sourceLabel: `Internet Archive · ${hit.identifier}`,
        status,
        fileUrl: status === 'available' && best ? best.url : undefined,
        mimeType: best?.mimeType,
        sizeBytes: best?.sizeBytes,
        rightsNote: detailed.rightsNote,
        reason: status === 'available' ? undefined : 'Rights for this item are not stated as open, so it cannot be queued.',
        sourcePageUrl: detailed.itemUrl,
        inspectedAt: checkedAt,
      });
    }
  } catch (err) {
    log.warn('archive.episode.failed', { message: (err as Error).message });
  }

  const available = candidates.some((c) => c.status === 'available');
  return {
    status: available ? 'available' : candidates.length ? 'unknown' : 'unavailable',
    candidates,
    checkedAt,
    note: available
      ? 'A permitted file for this episode was found.'
      : `No verified permitted file was found for ${code}. Episode metadata is not a file, and BlaxkVault will not fabricate an episode URL.`,
  };
}

export { config as adapterConfig };
