/**
 * Internet Archive adapter — the only shipped source that can legitimately
 * report `status: 'available'`.
 *
 * Docs: https://archive.org/developers/
 *   - Advanced search:  https://archive.org/advancedsearch.php
 *   - Item metadata:    https://archive.org/metadata/{identifier}
 *   - File download:    https://archive.org/download/{identifier}/{file}
 *
 * Critical rule taken straight from the blueprint: "presence of a file alone
 * does not prove permission." So this adapter refuses to call anything
 * `available` unless the item itself states an open licence or public-domain
 * status. Anything else comes back as `unknown` with a link to the item page so
 * the user can read the rights themselves.
 */
import { config } from '../config.js';
import { log } from '../logger.js';
import { upstream } from '../lib/errors.js';
import type { DownloadInspection, Downloadability } from '@blaxkvault/shared';
import { extensionOf, isSupportedMediaExtension, mimeForExtension, type InspectionContext, type SourceAdapter } from './types.js';

const SEARCH_URL = 'https://archive.org/advancedsearch.php';
const METADATA_URL = 'https://archive.org/metadata';
const DOWNLOAD_URL = 'https://archive.org/download';
const DETAILS_URL = 'https://archive.org/details';

const USER_AGENT = 'BlaxkVault/1.0 (self-hosted personal media manager; +https://archive.org/developers/)';

export interface ArchiveSearchItem {
  identifier: string;
  title: string;
  year?: number;
  creator?: string;
  mediatype: string;
  downloadCount?: number;
  /** Whether the item advertises an open licence / public-domain status. */
  rightsPermitted: boolean;
  rightsNote: string;
  licenseUrl?: string;
  itemUrl: string;
  thumbnailUrl: string;
}

export interface ArchiveFile {
  name: string;
  format?: string;
  sizeBytes?: number;
  length?: string;
  md5?: string;
}

export interface ArchiveItem {
  identifier: string;
  title: string;
  year?: number;
  description?: string;
  creator?: string;
  collection: string[];
  licenseUrl?: string;
  rightsPermitted: boolean;
  rightsNote: string;
  itemUrl: string;
  files: ArchiveFile[];
  /** Best playable/downloadable file for a browser-capable workflow. */
  bestFile?: ArchiveFile & { url: string; mimeType?: string };
  mock: false;
}

/* ------------------------------ transport -------------------------------- */

async function archiveFetchJson<T>(url: string, timeoutMs = 15_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 429) throw upstream('Internet Archive is rate limiting this server (429). Try again shortly.');
      throw upstream(`Internet Archive responded ${response.status}.`);
    }
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw upstream('Internet Archive did not respond in time.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------- rights assessment --------------------------- */

const OPEN_COLLECTIONS = [
  'publicdomain',
  'public_domain',
  'prelinger',
  'opensource_movies',
  'opensource_audio',
  'classic_cartoons',
  'feature_films',
  'film_noir',
  'moviestapes',
  'sfmoma',
  'computerchronicles',
  'ephemera',
  'universal_library',
  'additional_collections',
];

const OPEN_LICENSE_MARKERS = ['creativecommons.org', 'publicdomain', 'cc0', 'cc-by', 'openl', 'gnu.org/licenses'];

const PUBLIC_DOMAIN_PHRASES = [
  'public domain',
  'public-domain',
  'no known copyright',
  'not in copyright',
  'copyright expired',
  'no copyright',
];

export interface RightsAssessment {
  permitted: boolean;
  note: string;
  licenseUrl?: string;
}

export function assessArchiveRights(metadata: Record<string, unknown> | undefined): RightsAssessment {
  if (!metadata) {
    return {
      permitted: false,
      note: 'The item did not return usable rights metadata. Open the item page on archive.org and read the rights statement before downloading anything.',
    };
  }

  const licenseUrl = typeof metadata.licenseurl === 'string' ? metadata.licenseurl : undefined;
  const rights = typeof metadata.rights === 'string' ? metadata.rights : '';
  const possibleCopyright = typeof metadata['possible-copyright-status'] === 'string' ? (metadata['possible-copyright-status'] as string) : '';
  const collectionRaw = metadata.collection;
  const collections = (
    Array.isArray(collectionRaw) ? collectionRaw.filter((c): c is string => typeof c === 'string') : typeof collectionRaw === 'string' ? [collectionRaw] : []
  ).map((c) => c.toLowerCase());

  if (licenseUrl) {
    const lower = licenseUrl.toLowerCase();
    if (OPEN_LICENSE_MARKERS.some((marker) => lower.includes(marker))) {
      return {
        permitted: true,
        note: `The item declares an open licence (${licenseUrl}). Keep that licence with the file: attribution or share-alike terms may still apply.`,
        licenseUrl,
      };
    }
    return {
      permitted: false,
      note: `The item points at a licence BlaxkVault cannot verify automatically (${licenseUrl}). Read it on the item page before downloading.`,
      licenseUrl,
    };
  }

  const combined = `${rights} ${possibleCopyright}`.toLowerCase().replace(/[_-]+/g, ' ');
  if (PUBLIC_DOMAIN_PHRASES.some((phrase) => combined.includes(phrase))) {
    return {
      permitted: true,
      note: rights ? `Item rights statement: "${rights}".` : 'The item records a public-domain status.',
    };
  }

  const openCollection = collections.find((c) => OPEN_COLLECTIONS.some((open) => c.includes(open)));
  if (openCollection && /public|opensource|prelinger/i.test(openCollection)) {
    return {
      permitted: true,
      note: `The item belongs to the open "${openCollection}" collection on archive.org. Verify any further conditions on the item page.`,
    };
  }

  return {
    permitted: false,
    note:
      'The item does not state a public-domain status or an open licence, so BlaxkVault cannot confirm that downloading it is permitted. Presence of a file on archive.org is not proof of permission — open the item page and read its rights statement.',
  };
}

/* ------------------------------ item files ------------------------------- */

function normalizeFiles(rawFiles: unknown[] | undefined): ArchiveFile[] {
  if (!Array.isArray(rawFiles)) return [];
  return rawFiles
    .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
    .map((f) => ({
      name: typeof f.name === 'string' ? f.name : '',
      format: typeof f.format === 'string' ? f.format : undefined,
      sizeBytes: typeof f.size === 'string' ? Number.parseInt(f.size, 10) || undefined : typeof f.size === 'number' ? f.size : undefined,
      length: typeof f.length === 'number' ? String(f.length) : typeof f.length === 'string' ? f.length : undefined,
      md5: typeof f.md5 === 'string' ? f.md5 : undefined,
    }))
    .filter((f) => f.name && !f.name.startsWith('__ia_thumb') && !f.name.endsWith('.torrent') && !f.name.endsWith('_meta.xml'))
    .filter((f) => isSupportedMediaExtension(extensionOf(f.name)));
}

const FORMAT_PREFERENCE = ['h.264', 'mpeg4', '512kb mpeg4', 'h.264 ia', 'mpeg4 ia', 'ogg video', 'webm', 'windows media', 'matroska'];

export function pickBestFile(files: ArchiveFile[]): ArchiveFile | undefined {
  if (files.length === 0) return undefined;
  const videoFirst = files.filter((f) => /\.(mp4|m4v|webm|ogv|mkv|avi|mov|mpg|mpeg)$/i.test(f.name));
  const pool = videoFirst.length > 0 ? videoFirst : files;

  const scored = [...pool].sort((a, b) => {
    const rank = (f: ArchiveFile) => {
      const ext = extensionOf(f.name);
      const browserBonus = ['mp4', 'm4v', 'webm', 'ogv'].includes(ext) ? 0 : 100; // prefer files the browser can play directly
      const formatIndex = FORMAT_PREFERENCE.findIndex((p) => (f.format ?? '').toLowerCase().includes(p));
      const formatBonus = formatIndex === -1 ? 50 : formatIndex;
      // Prefer larger files only among equally-playable options (higher bitrate copy).
      const sizePenalty = browserBonus === 0 && formatBonus < 50 ? -(f.sizeBytes ?? 0) / 1e12 : 0;
      return browserBonus + formatBonus + sizePenalty;
    };
    return rank(a) - rank(b);
  });
  return scored[0];
}

export function itemToFiles(rawItem: { files?: unknown[] }): ArchiveFile[] {
  return normalizeFiles(rawItem.files);
}

/* -------------------------------- search --------------------------------- */

interface AdvancedSearchResponse {
  response?: {
    numFound?: number;
    start?: number;
    docs?: Record<string, unknown>[];
  };
}

export async function searchArchiveMovies(query: string, page = 1, rows = 24): Promise<ArchiveSearchItem[]> {
  const sanitized = query.replace(/["\\]/g, ' ').trim();
  const url =
    `${SEARCH_URL}?q=${encodeURIComponent(`(${sanitized}) AND mediatype:(movies)`)}` +
    `&fl[]=identifier&fl[]=title&fl[]=year&fl[]=creator&fl[]=mediatype&fl[]=downloads&fl[]=licenseurl&fl[]=collection&fl[]=rights` +
    `&rows=${rows}&page=${page}&output=json&sort[]=downloads+desc`;

  const raw = await archiveFetchJson<AdvancedSearchResponse>(url);
  const docs = raw.response?.docs ?? [];
  const items = docs
    .map((doc): ArchiveSearchItem | null => {
      const identifier = typeof doc.identifier === 'string' ? doc.identifier : Array.isArray(doc.identifier) ? String(doc.identifier[0]) : null;
      if (!identifier) return null;
      const rights = assessArchiveRights(doc as Record<string, unknown>);
      const collection = Array.isArray(doc.collection) ? doc.collection.map(String) : typeof doc.collection === 'string' ? [doc.collection] : [];
      return {
        identifier,
        title: typeof doc.title === 'string' ? doc.title : Array.isArray(doc.title) ? String(doc.title[0]) : identifier,
        year: Number.parseInt(String(doc.year ?? ''), 10) || undefined,
        creator: typeof doc.creator === 'string' ? doc.creator : Array.isArray(doc.creator) ? String(doc.creator[0]) : undefined,
        mediatype: typeof doc.mediatype === 'string' ? doc.mediatype : 'movies',
        downloadCount: typeof doc.downloads === 'number' ? doc.downloads : Number.parseInt(String(doc.downloads ?? ''), 10) || undefined,
        rightsPermitted: rights.permitted,
        rightsNote: rights.note,
        licenseUrl: rights.licenseUrl,
        itemUrl: `${DETAILS_URL}/${identifier}`,
        thumbnailUrl: `https://archive.org/services/img/${identifier}`,
        ...(collection.length ? { collection } : {}),
      };
    })
    .filter((i): i is ArchiveSearchItem => i !== null);

  log.debug('archive.search', { query: sanitized, page, results: items.length });
  return items;
}

/* -------------------------------- item ----------------------------------- */

interface MetadataResponse {
  metadata?: Record<string, unknown>;
  files?: unknown[];
}

export async function getArchiveItem(identifier: string): Promise<ArchiveItem> {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(identifier)) throw upstream('That archive.org identifier looks malformed.');
  const raw = await archiveFetchJson<MetadataResponse>(`${METADATA_URL}/${encodeURIComponent(identifier)}`);
  const metadata = raw.metadata ?? {};
  const rights = assessArchiveRights(metadata);
  const files = normalizeFiles(raw.files);
  const best = pickBestFile(files);
  const collectionRaw = metadata.collection;

  return {
    identifier,
    title: typeof metadata.title === 'string' ? metadata.title : identifier,
    year: Number.parseInt(String(metadata.year ?? metadata.date ?? ''), 10) || undefined,
    description: typeof metadata.description === 'string' ? metadata.description : undefined,
    creator: typeof metadata.creator === 'string' ? metadata.creator : Array.isArray(metadata.creator) ? String(metadata.creator[0]) : undefined,
    collection: Array.isArray(collectionRaw) ? collectionRaw.map(String) : typeof collectionRaw === 'string' ? [collectionRaw] : [],
    licenseUrl: rights.licenseUrl,
    rightsPermitted: rights.permitted,
    rightsNote: rights.note,
    itemUrl: `${DETAILS_URL}/${identifier}`,
    files,
    bestFile: best
      ? {
          ...best,
          url: `${DOWNLOAD_URL}/${identifier}/${encodeURIComponent(best.name)}`,
          mimeType: mimeForExtension(extensionOf(best.name)),
        }
      : undefined,
    mock: false,
  };
}

/** Search the archive and keep only items whose own rights fields allow download. */
export async function searchArchivePermitted(query: string, page = 1): Promise<ArchiveSearchItem[]> {
  const items = await searchArchiveMovies(query, page);
  return items.filter((item) => item.rightsPermitted);
}

/* ------------------------------- adapter ---------------------------------- */

function parseArchiveUrl(input: string): { identifier: string; file?: string } | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (!/(^|\.)archive\.org$/i.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const [kind, identifier, ...rest] = parts;
  if (!identifier) return null;
  if (kind === 'download') return { identifier, file: rest.length ? decodeURIComponent(rest.join('/')) : undefined };
  if (kind === 'details') return { identifier };
  return null;
}

export function createArchiveAdapter(): SourceAdapter {
  return {
    id: 'internet-archive',
    label: 'Internet Archive',
    capabilities: ['metadata', 'authorized-download'],
    docsUrl: 'https://archive.org/developers/',
    description:
      'archive.org hosts millions of public-domain and openly licensed films and recordings. BlaxkVault reads each item\'s own licence and rights fields, and only offers a download when the item states an open licence or public-domain status. Items with unclear rights are listed but never auto-queued.',
    attribution: 'Item data and media from Internet Archive (archive.org). Verify each item\'s rights statement.',
    requiresKey: null,
    enabled: () => true,
    inspect: async (input: string, ctx: InspectionContext): Promise<DownloadInspection> => {
      const parsed = parseArchiveUrl(input);
      const inspectedAt = new Date().toISOString();

      if (!parsed) {
        return {
          status: 'unsupported',
          sourcePageUrl: input,
          inspectedBy: 'internet-archive',
          inspectedAt,
          reason: 'That URL is not an archive.org item or download link.',
        };
      }

      const item = await getArchiveItem(parsed.identifier);
      const file = parsed.file
        ? item.files.find((f) => f.name === parsed.file) ?? (parsed.file ? { name: parsed.file } : undefined)
        : item.bestFile;

      if (!file) {
        return {
          status: 'unavailable',
          sourcePageUrl: item.itemUrl,
          inspectedBy: 'internet-archive',
          inspectedAt,
          rightsNote: item.rightsNote,
          reason: 'This archive.org item contains no media file in a supported container.',
        };
      }

      const extension = extensionOf(file.name);
      if (!isSupportedMediaExtension(extension)) {
        return {
          status: 'unsupported',
          sourcePageUrl: item.itemUrl,
          inspectedBy: 'internet-archive',
          inspectedAt,
          rightsNote: item.rightsNote,
          reason: `The best file in this item is a .${extension} file, which BlaxkVault cannot verify as downloadable media.`,
        };
      }

      const status: Downloadability = item.rightsPermitted ? 'available' : 'unknown';
      return {
        status,
        sourcePageUrl: item.itemUrl,
        fileUrl: item.rightsPermitted ? `${DOWNLOAD_URL}/${item.identifier}/${encodeURIComponent(file.name)}` : undefined,
        mimeType: mimeForExtension(extension),
        sizeBytes: file.sizeBytes,
        rightsNote: item.rightsNote,
        reason: item.rightsPermitted
          ? undefined
          : 'Rights are not stated as public domain or openly licensed, so this file cannot be queued automatically. Open the item page to review the rights statement.',
        inspectedBy: 'internet-archive',
        inspectedAt,
      };
    },
  };
}

export const ARCHIVE_ATTRIBUTION = 'Media and metadata from Internet Archive — archive.org';

export function archiveEnabled(): boolean {
  return true;
}

export function archiveConfigSummary(): { regionFree: boolean; apiKeyRequired: boolean } {
  return { regionFree: true, apiKeyRequired: false };
}

export const archiveBaseUrl = { SEARCH_URL, METADATA_URL, DOWNLOAD_URL, DETAILS_URL };
export const archiveUserAgent = USER_AGENT;
export const configRegionHint = config.tmdb.region;
