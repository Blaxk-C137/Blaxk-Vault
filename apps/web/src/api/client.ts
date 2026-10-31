/**
 * Typed API client.
 *
 * Every server error carries a stable `code` plus a message that is already
 * safe to display, so the UI shows the real reason ("The remote server returned
 * 404 — the file is no longer at that URL") instead of a generic failure.
 */
import type {
  ApiErrorBody,
  AppSettings,
  CreateDownloadInput,
  DiskUsage,
  DownloadJob,
  DownloadabilityAssessment,
  Episode,
  HealthResponse,
  LibraryItem,
  LibraryScanResult,
  LocalCopiesResponse,
  MediaKind,
  PlaybackProgress,
  SearchResponse,
  SeasonSummary,
  SettingsPatch,
  SourceAdapterDescriptor,
  SystemStats,
  TitleAvailability,
  TitleDetail,
  TrendingResponse,
} from '@blaxkvault/shared';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code = 'INTERNAL', status = 500, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** True when the server told us the resource genuinely is not there. */
  get isMissing(): boolean {
    return this.status === 404;
  }
}

/**
 * The preview/embedded environments may serve the UI from the same origin as
 * the API. Relative URLs keep the client free of host assumptions.
 */
const BASE = '';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, { ...init, headers });
  } catch (err) {
    throw new ApiError(
      navigator.onLine === false
        ? 'You appear to be offline, so BlaxkVault could not reach its server.'
        : `Could not reach the BlaxkVault server (${(err as Error).message}). Is it still running?`,
      'NETWORK',
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const body = parsed as ApiErrorBody | undefined;
    const message =
      body?.error?.message ??
      (typeof parsed === 'string' && parsed.length < 300 ? parsed : `Request failed with status ${response.status}.`);
    throw new ApiError(message, body?.error?.code ?? 'INTERNAL', response.status, body?.error?.details);
  }

  return parsed as T;
}

export interface ArchiveSearchItemDto {
  identifier: string;
  title: string;
  year?: number;
  creator?: string;
  mediatype: string;
  downloadCount?: number;
  rightsPermitted: boolean;
  rightsNote: string;
  licenseUrl?: string;
  itemUrl: string;
  thumbnailUrl: string;
}

export interface ArchiveItemDto {
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
  files: { name: string; format?: string; sizeBytes?: number; length?: string }[];
  bestFile?: { name: string; format?: string; sizeBytes?: number; url: string; mimeType?: string };
}

export interface InspectionResponse {
  inspection: {
    status: DownloadabilityAssessment['status'];
    sourcePageUrl: string;
    fileUrl?: string;
    mimeType?: string;
    sizeBytes?: number;
    rightsNote?: string;
    reason?: string;
    inspectedBy: string;
    inspectedAt: string;
    probe?: {
      tool: string;
      container?: string;
      videoCodec?: string;
      audioCodec?: string;
      durationSeconds?: number;
      browserPlayable: boolean;
      notes?: string[];
    };
  };
  adapter: { id: string; label: string };
}

export const api = {
  health: () => request<HealthResponse>('/api/health'),

  search: (query: string, kind: MediaKind | 'multi' = 'multi', page = 1) =>
    request<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}&kind=${kind}&page=${page}`),

  trending: () => request<TrendingResponse>('/api/trending'),

  title: (id: string) => request<TitleDetail>(`/api/titles/${encodeURIComponent(id)}`),

  seasons: (id: string) => request<{ seasons: SeasonSummary[]; attribution: string }>(`/api/titles/${encodeURIComponent(id)}/seasons`),

  season: (id: string, seasonNumber: number) =>
    request<{ seasonNumber: number; episodes: Episode[] }>(`/api/titles/${encodeURIComponent(id)}/season/${seasonNumber}`),

  availability: (id: string) => request<TitleAvailability>(`/api/titles/${encodeURIComponent(id)}/availability`),

  downloadability: (id: string) =>
    request<DownloadabilityAssessment>(`/api/titles/${encodeURIComponent(id)}/downloadability`),

  episodeDownloadability: (input: { seriesTitle: string; seasonNumber: number; episodeNumber: number }) =>
    request<DownloadabilityAssessment>('/api/titles/episodes/downloadability', { method: 'POST', body: JSON.stringify(input) }),

  sources: () =>
    request<{ sources: SourceAdapterDescriptor[]; note: string }>('/api/sources'),

  inspect: (url: string, context?: { title?: string; year?: number; kind?: MediaKind; tmdbId?: number }) =>
    request<InspectionResponse>('/api/sources/inspect', { method: 'POST', body: JSON.stringify({ url, context }) }),

  archiveSearch: (query: string, page = 1) =>
    request<{ query: string; page: number; results: ArchiveSearchItemDto[]; attribution: string; note: string }>(
      `/api/archive/search?q=${encodeURIComponent(query)}&page=${page}`,
    ),

  archiveItem: (identifier: string) => request<ArchiveItemDto>(`/api/archive/items/${encodeURIComponent(identifier)}`),

  jobs: () => request<{ jobs: DownloadJob[]; limits: { maxConcurrent: number; bandwidthLimitKbps: number; maxBytes: number }; stats: ReturnType<never> }>('/api/downloads'),

  createDownload: (input: CreateDownloadInput) =>
    request<{ job: DownloadJob }>('/api/downloads', { method: 'POST', body: JSON.stringify(input) }),

  pauseDownload: (id: string) => request<{ job: DownloadJob }>(`/api/downloads/${id}/pause`, { method: 'POST' }),
  resumeDownload: (id: string) => request<{ job: DownloadJob }>(`/api/downloads/${id}/resume`, { method: 'POST' }),
  cancelDownload: (id: string) => request<{ job: DownloadJob }>(`/api/downloads/${id}/cancel`, { method: 'POST' }),
  retryDownload: (id: string) => request<{ job: DownloadJob }>(`/api/downloads/${id}/retry`, { method: 'POST' }),
  removeDownload: (id: string) => request<{ removed: boolean; message: string }>(`/api/downloads/${id}`, { method: 'DELETE' }),
  deleteDownloadFile: (id: string) =>
    request<{ deleted: boolean; message: string }>(`/api/downloads/${id}/file?confirm=true`, { method: 'DELETE' }),

  library: (params: { q?: string; kind?: string; sort?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.kind) search.set('kind', params.kind);
    if (params.sort) search.set('sort', params.sort);
    const qs = search.toString();
    return request<{ items: LibraryItem[]; stats: { items: number; bytes: number; missing: number }; roots: { root: string; exists: boolean; writable: boolean }[] }>(
      `/api/library${qs ? `?${qs}` : ''}`,
    );
  },

  libraryItem: (id: string) => request<{ item: LibraryItem; progress: PlaybackProgress | null }>(`/api/library/items/${id}`),

  libraryStats: () => request<{ stats: { items: number; bytes: number; missing: number }; storage: { root: string; exists: boolean; writable: boolean; itemCount: number; bytes: number; error?: string }[] }>('/api/library/stats'),

  scanLibrary: () => request<{ result: LibraryScanResult; stats: { items: number; bytes: number; missing: number } }>('/api/library/scan', { method: 'POST' }),

  saveProgress: (id: string, input: { positionSeconds: number; durationSeconds?: number; completed?: boolean }) =>
    request<{ progress: PlaybackProgress }>(`/api/library/items/${id}/progress`, { method: 'PATCH', body: JSON.stringify(input) }),

  /** Files this machine already holds for a catalogue title. */
  localCopies: (id: string) => request<LocalCopiesResponse>(`/api/titles/${encodeURIComponent(id)}/local-copies`),

  settings: () => request<{ settings: AppSettings; storage: { root: string; exists: boolean; writable: boolean; itemCount: number; bytes: number; error?: string }[] }>('/api/settings'),

  patchSettings: (patch: SettingsPatch) =>
    request<{ settings: AppSettings; changed: string[]; warnings: string[] }>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  stats: () => request<SystemStats>('/api/stats'),

  streamUrl: (id: string) => `/api/library/stream?id=${encodeURIComponent(id)}`,

  disk: () => request<{ settings: AppSettings }>('/api/settings').then((r) => r.settings.disk as DiskUsage),
};
