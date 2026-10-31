/**
 * @blaxkvault/shared — the single typed contract shared by the Fastify server
 * and the React client.
 *
 * Design rules encoded here (see docs/UI_RESEARCH.md, docs/ARCHITECTURE.md):
 *  - A metadata entry is never a download link. Metadata, watch availability
 *    and downloadability are three separate concepts and never collapsed.
 *  - Downloadability is a four-state verdict: available | unavailable |
 *    unsupported | unknown. "unknown" is a legitimate answer, not an error.
 *  - Nothing in these types can express "DRM bypass" or "scrape a streaming
 *    provider": adapters may only ever return an inspected, authorized direct
 *    HTTP(S) resource.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------------- */
/* Core vocabularies                                                          */
/* ------------------------------------------------------------------------- */

export const MEDIA_KINDS = ['movie', 'tv'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const DOWNLOADABILITY_STATES = ['available', 'unavailable', 'unsupported', 'unknown'] as const;
export type Downloadability = (typeof DOWNLOADABILITY_STATES)[number];

export const SOURCE_CAPABILITIES = ['metadata', 'availability', 'authorized-download', 'local-library'] as const;
export type SourceCapability = (typeof SOURCE_CAPABILITIES)[number];

/** Download job state machine: inspected → queued → downloading → completed,
 *  with paused / failed / cancelled / unsupported / unavailable branches. */
export const DOWNLOAD_STATUSES = [
  'inspected',
  'queued',
  'downloading',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'unsupported',
  'unavailable',
] as const;
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[number];

/** Terminal states never transition again without an explicit retry. */
export const TERMINAL_DOWNLOAD_STATUSES: DownloadStatus[] = ['completed', 'failed', 'cancelled', 'unsupported', 'unavailable'];

export const ACTIVE_DOWNLOAD_STATUSES: DownloadStatus[] = ['queued', 'downloading', 'paused'];

/* ------------------------------------------------------------------------- */
/* Source adapter contract (blueprint §6)                                     */
/* ------------------------------------------------------------------------- */

export interface DownloadInspection {
  status: Downloadability;
  sourcePageUrl: string;
  /** Only ever a verified, authorized direct resource. Never a web page. */
  fileUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Plain-language statement of why we believe the download is permitted. */
  rightsNote?: string;
  /** Plain-language explanation for anything that is not `available`. */
  reason?: string;
  /** Optional probe enrichment (ffprobe or header sniffing). */
  probe?: MediaProbeSummary;
  /** Human text of the inspecting adapter, for the UI. */
  inspectedBy: string;
  inspectedAt: string;
}

export interface SourceAdapterDescriptor {
  id: string;
  label: string;
  capabilities: SourceCapability[];
  /** True when the adapter is configured and usable right now. */
  enabled: boolean;
  /** Server-side credential name required (never the value itself). */
  requiresKey?: 'TMDB_API_KEY' | 'WATCHMODE_API_KEY' | null;
  /** What this adapter can and cannot do — shown verbatim in the UI. */
  description: string;
  /** Attribution string that must be displayed when its data is used. */
  attribution?: string;
  docsUrl: string;
}

/* ------------------------------------------------------------------------- */
/* Discovery (TMDB — metadata only)                                           */
/* ------------------------------------------------------------------------- */

export interface TitleSummary {
  /** Namespaced id, e.g. `tmdb:movie:603`. Always prefixed by provider. */
  id: string;
  provider: 'tmdb' | 'local';
  tmdbId?: number;
  kind: MediaKind;
  title: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  genreIds?: number[];
  /** Confirmed offline copy in the local library, when known. */
  inLibrary?: boolean;
}

export interface Genre {
  id: number;
  name: string;
}

export interface CastMember {
  id: number;
  name: string;
  character?: string;
  profileUrl?: string;
  order: number;
}

export interface CrewMember {
  id: number;
  name: string;
  job: string;
  profileUrl?: string;
}

export interface SeasonSummary {
  seasonNumber: number;
  name: string;
  overview?: string;
  episodeCount: number;
  airDate?: string;
  posterUrl?: string;
}

export interface Episode {
  id: string;
  seasonNumber: number;
  episodeNumber: number;
  name: string;
  overview?: string;
  airDate?: string;
  runtimeMinutes?: number;
  stillUrl?: string;
  voteAverage?: number;
  voteCount?: number;
  /** Per-episode downloadability verdict (never invented). */
  downloadability?: Downloadability;
}

export interface TitleDetail extends TitleSummary {
  tagline?: string;
  status?: string;
  releaseDate?: string;
  runtimeMinutes?: number;
  genres: Genre[];
  cast: CastMember[];
  crew: CrewMember[];
  seasons?: SeasonSummary[];
  imdbId?: string;
  homepage?: string;
  /** TMDB-sourced content must always display attribution in the UI. */
  attribution: string;
}

export interface SearchResponse {
  query: string;
  page: number;
  totalPages: number;
  totalResults: number;
  results: TitleSummary[];
  provider: 'tmdb';
  /** True when results come from the bundled offline fixture (no API key). */
  mock: boolean;
  attribution: string;
  tookMs: number;
}

export interface TrendingResponse {
  results: TitleSummary[];
  mock: boolean;
  attribution: string;
}

/* ------------------------------------------------------------------------- */
/* Availability (Watchmode / TMDB region data — listings, never files)        */
/* ------------------------------------------------------------------------- */

export type AvailabilityType = 'stream' | 'rent' | 'buy' | 'free' | 'ads' | 'theatrical' | 'unknown';

export interface AvailabilityProvider {
  providerId: number;
  name: string;
  logoUrl?: string;
  type: AvailabilityType;
  region: string;
  /** Deep link to the provider's own page. Not a video file. */
  linkUrl: string;
  priceSummary?: string;
  quality?: string;
}

export interface TitleAvailability {
  tmdbId?: number;
  kind: MediaKind;
  region: string;
  linkUrl?: string;
  providers: AvailabilityProvider[];
  /** `mock` renders the "sample data" badge instead of lying. */
  source: 'watchmode' | 'tmdb' | 'mock';
  fetchedAt: string;
  attribution: string;
  note: string;
}

/* ------------------------------------------------------------------------- */
/* Downloadability assessment (composite of all source adapters)              */
/* ------------------------------------------------------------------------- */

export interface DownloadCandidate {
  sourceId: string;
  sourceLabel: string;
  status: Downloadability;
  fileUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  rightsNote?: string;
  reason?: string;
  /** Rights/verification link the user can open and read. */
  sourcePageUrl?: string;
  probe?: MediaProbeSummary;
  inspectedAt: string;
}

export interface DownloadabilityAssessment {
  status: Downloadability;
  /** Ordered candidates; only `available` ones may be queued. */
  candidates: DownloadCandidate[];
  checkedAt: string;
  note: string;
}

/* ------------------------------------------------------------------------- */
/* Media probing                                                              */
/* ------------------------------------------------------------------------- */

export interface MediaProbeSummary {
  /** `ffprobe` when the binary exists, otherwise `container-sniff`. */
  tool: 'ffprobe' | 'container-sniff' | 'none';
  container?: string;
  mimeType?: string;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  bitrate?: number;
  /** Browser-playable without transcoding (used to explain unsupported files). */
  browserPlayable: boolean;
  notes?: string[];
}

/* ------------------------------------------------------------------------- */
/* Download jobs                                                              */
/* ------------------------------------------------------------------------- */

export interface DownloadJobRef {
  title?: string;
  year?: number;
  kind?: MediaKind;
  tmdbId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeName?: string;
  posterUrl?: string;
}

export interface DownloadJob {
  id: string;
  status: DownloadStatus;
  engine: 'native' | 'aria2';
  sourceId: string;
  sourcePageUrl: string;
  fileUrl: string;
  fileName: string;
  relativePath: string;
  absolutePath: string;
  bytesTotal?: number;
  bytesDownloaded: number;
  speedBps: number;
  etaSeconds?: number;
  progress: number; // 0..1, only when bytesTotal is known
  rightsNote?: string;
  ref: DownloadJobRef;
  error?: string;
  /** Real engine-reported error class, shown verbatim in the UI. */
  errorCode?: string;
  attempts: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface CreateDownloadInput {
  fileUrl: string;
  sourcePageUrl: string;
  rightsNote?: string;
  ref?: DownloadJobRef;
  /** Optional final filename (sanitized server-side); otherwise derived. */
  fileName?: string;
  bytesTotal?: number;
  sourceId?: string;
}

/* ------------------------------------------------------------------------- */
/* Library                                                                    */
/* ------------------------------------------------------------------------- */

export interface LibraryItem {
  id: string;
  /** Path relative to the configured media root; never an absolute leak in list views. */
  relativePath: string;
  fileName: string;
  kind: MediaKind | 'other';
  sizeBytes: number;
  extension: string;
  modifiedAt: string;
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  inProgress?: boolean;
  missing?: boolean;
  probe?: MediaProbeSummary;
  subtitleTracks: SubtitleTrack[];
  unsupportedReason?: string;
}

export interface SubtitleTrack {
  label: string;
  language: string;
  /** Server-relative URL the player can fetch. */
  url: string;
}

export interface LibraryScanResult {
  scannedAt: string;
  roots: string[];
  fileCount: number;
  newItems: number;
  removedItems: number;
  durationMs: number;
}

export interface PlaybackProgress {
  itemId: string;
  positionSeconds: number;
  durationSeconds?: number;
  updatedAt: string;
  completed?: boolean;
}

/* ------------------------------------------------------------------------- */
/* Settings                                                                   */
/* ------------------------------------------------------------------------- */

export interface AppSettings {
  downloadDir: string;
  maxConcurrentDownloads: number;
  bandwidthLimitKbps: number;
  maxDownloadBytes: number;
  theme: 'dark' | 'light' | 'system';
  reducedMotion: 'system' | 'reduce' | 'allow';
  tmdbRegion: string;
  tmdbLanguage: string;
  watchmodeRegion: string;
  aria2Enabled: boolean;
  aria2RpcUrl: string;
  /** Never returns ARIA2_RPC_SECRET itself — only whether one is set. */
  aria2SecretConfigured: boolean;
  ffprobeAvailable: boolean;
  ffmpegAvailable: boolean;
  mediaRoots: string[];
  disk: DiskUsage;
}

export interface DiskUsage {
  path: string;
  freeBytes?: number;
  totalBytes?: number;
  usedBytes?: number;
  error?: string;
}

export interface SettingsPatch {
  downloadDir?: string;
  maxConcurrentDownloads?: number;
  bandwidthLimitKbps?: number;
  maxDownloadBytes?: number;
  theme?: AppSettings['theme'];
  reducedMotion?: AppSettings['reducedMotion'];
  tmdbRegion?: string;
  tmdbLanguage?: string;
  watchmodeRegion?: string;
  aria2Enabled?: boolean;
  aria2RpcUrl?: string;
  mediaRoots?: string[];
}

/* ------------------------------------------------------------------------- */
/* System / realtime                                                          */
/* ------------------------------------------------------------------------- */

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  clock: string;
  capabilities: {
    tmdb: boolean;
    watchmode: boolean;
    archive: boolean;
    aria2: boolean;
    ffprobe: boolean;
    ffmpeg: boolean;
    database: boolean;
  };
  mode: 'live' | 'fixture';
  accessControl: 'loopback-only' | 'token-required' | 'open';
}

export interface SystemStats {
  queued: number;
  active: number;
  completed: number;
  failed: number;
  totalSpeedBps: number;
  bytesDownloadedToday: number;
  libraryItems: number;
  libraryBytes: number;
  disk: DiskUsage;
}

export type ServerEvent =
  | { type: 'hello'; at: string; stats: SystemStats }
  | { type: 'job.updated'; at: string; job: DownloadJob }
  | { type: 'job.removed'; at: string; jobId: string }
  | { type: 'jobs.snapshot'; at: string; jobs: DownloadJob[] }
  | { type: 'library.updated'; at: string; result: LibraryScanResult }
  | { type: 'stats'; at: string; stats: SystemStats }
  | { type: 'notice'; at: string; level: 'info' | 'warn' | 'error'; message: string };

/* ------------------------------------------------------------------------- */
/* Errors                                                                     */
/* ------------------------------------------------------------------------- */

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const BLAXKVAULT_VERSION = '1.0.0';

/* ------------------------------------------------------------------------- */
/* Zod schemas — every inbound request is validated with these (§9)           */
/* ------------------------------------------------------------------------- */

const httpUrl = z
  .string()
  .trim()
  .min(8)
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), 'Must be an http(s) URL');

export const jobRefSchema = z.object({
  title: z.string().max(300).optional(),
  year: z.number().int().min(1878).max(2200).optional(),
  kind: z.enum(MEDIA_KINDS).optional(),
  tmdbId: z.number().int().positive().optional(),
  seasonNumber: z.number().int().min(0).max(200).optional(),
  episodeNumber: z.number().int().min(0).max(5000).optional(),
  episodeName: z.string().max(300).optional(),
  posterUrl: z.string().max(2048).optional(),
});

export const createDownloadSchema = z.object({
  fileUrl: httpUrl,
  sourcePageUrl: httpUrl,
  rightsNote: z.string().max(500).optional(),
  fileName: z.string().max(240).optional(),
  bytesTotal: z.number().int().nonnegative().optional(),
  sourceId: z.string().max(60).optional(),
  ref: jobRefSchema.optional(),
});

export const inspectRequestSchema = z.object({
  url: httpUrl,
  /** Present when inspecting a candidate found through a known adapter. */
  sourceId: z.string().max(60).optional(),
  context: z
    .object({
      title: z.string().max(300).optional(),
      year: z.number().int().optional(),
      kind: z.enum(MEDIA_KINDS).optional(),
      tmdbId: z.number().int().positive().optional(),
      seasonNumber: z.number().int().optional(),
      episodeNumber: z.number().int().optional(),
    })
    .optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(120),
  page: z.coerce.number().int().min(1).max(500).default(1),
  kind: z.enum([...MEDIA_KINDS, 'multi']).default('multi'),
});

export const libraryQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  kind: z.enum(['movie', 'tv', 'other', 'all']).default('all'),
  sort: z.enum(['recent', 'title', 'size']).default('recent'),
  missing: z.coerce.boolean().optional(),
});

export const settingsPatchSchema = z
  .object({
    downloadDir: z.string().min(1).max(1024).optional(),
    maxConcurrentDownloads: z.number().int().min(1).max(8).optional(),
    bandwidthLimitKbps: z.number().int().min(0).max(1_000_000).optional(),
    maxDownloadBytes: z.number().int().min(0).optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
    reducedMotion: z.enum(['system', 'reduce', 'allow']).optional(),
    tmdbRegion: z.string().length(2).optional(),
    tmdbLanguage: z.string().min(2).max(10).optional(),
    watchmodeRegion: z.string().length(2).optional(),
    aria2Enabled: z.boolean().optional(),
    aria2RpcUrl: z
      .string()
      .max(300)
      .refine((v) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//.test(v), 'aria2 RPC must stay on loopback')
      .optional(),
    mediaRoots: z.array(z.string().min(1).max(1024)).max(8).optional(),
  })
  .strict();

export const progressPatchSchema = z.object({
  positionSeconds: z.number().min(0),
  durationSeconds: z.number().min(0).optional(),
  completed: z.boolean().optional(),
});

export const archiveSearchSchema = z.object({
  q: z.string().trim().min(1).max(120),
  page: z.coerce.number().int().min(1).max(100).default(1),
  mediatype: z.string().max(30).default('movies'),
});

/* ------------------------------------------------------------------------- */
/* Small shared helpers                                                       */
/* ------------------------------------------------------------------------- */

export function formatBytes(bytes?: number | null, digits = 1): string {
  if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatSpeed(bps?: number | null): string {
  if (!bps || bps <= 0) return '—';
  return `${formatBytes(bps, 1)}/s`;
}

export function formatEta(seconds?: number | null): string {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function formatRuntime(minutes?: number | null): string {
  if (!minutes || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/* ------------------------------------------------------------------------- */
/* Title matching                                                             */
/* ------------------------------------------------------------------------- */

/** Words that carry no identifying weight when comparing two titles. */
const TITLE_STOPWORDS = new Set(['the', 'a', 'an', 'and', 'of', 'la', 'le', 'les', 'el', 'los', 'der', 'die', 'das', 'il', 'un', 'une']);

/**
 * Normalise a title for comparison: lowercase, strip accents and punctuation,
 * collapse whitespace and drop articles.
 *
 * Deliberately not a fuzzy matcher — it is the *shared* rule that the catalogue,
 * the archive matcher and the local library all use, so "Metropolis",
 * "metropolis (1927)" and "METROPOLIS." are one title while "D.O.A." and
 * "pinoy rated r" never become each other.
 */
export function normalizeTitle(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);

  // Articles and connectives carry no identifying weight — but only drop them
  // when something is left. "D.O.A." is three single letters, and dropping the
  // "a" as an article would turn it into "d o"; "A" and "I" are also real film
  // titles. Falling back to the unfiltered words keeps those intact.
  const distinctive = words.filter((word) => word.length > 1 && !TITLE_STOPWORDS.has(word));
  return (distinctive.length > 0 ? distinctive : words).join(' ').trim();
}

/** Distinctive words of a normalised title. */
export function titleTokens(title: string): string[] {
  return normalizeTitle(title).split(' ').filter(Boolean);
}

/**
 * How much of `query` appears in `candidate`, 0..1. Used to reject archive items
 * whose metadata merely mentions the title (or does not match it at all).
 */
export function titleAgreement(query: string, candidate: string): number {
  const queryTokens = titleTokens(query);
  if (queryTokens.length === 0) return 0;
  const candidateTokens = new Set(titleTokens(candidate));
  const hits = queryTokens.filter((token) => candidateTokens.has(token)).length;
  return hits / queryTokens.length;
}

/** A file already in the user's library that matches a catalogue title. */
export interface LocalCopy {
  id: string;
  relativePath: string;
  fileName: string;
  sizeBytes: number;
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  inProgress?: boolean;
  missing?: boolean;
}

export interface LocalCopiesResponse {
  /** Files in the local library that match this title, best first. */
  copies: LocalCopy[];
  /** Plain-language explanation of how they were matched. */
  note: string;
}

/** Human labels for the four downloadability verdicts, used everywhere. */
export const DOWNLOADABILITY_LABEL: Record<Downloadability, string> = {
  available: 'Permitted file available',
  unavailable: 'No permitted file found',
  unsupported: 'Source not supported',
  unknown: 'Not yet verified',
};

export const DOWNLOAD_STATUS_LABEL: Record<DownloadStatus, string> = {
  inspected: 'Inspected',
  queued: 'Queued',
  downloading: 'Downloading',
  paused: 'Paused',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  unsupported: 'Unsupported',
  unavailable: 'Unavailable',
};
