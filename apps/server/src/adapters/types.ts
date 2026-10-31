/**
 * The adapter contract (blueprint §6). An adapter may only ever:
 *   - return metadata,
 *   - return availability listings (where a title can be watched),
 *   - or return a verified, authorized *direct* HTTP(S) resource.
 *
 * No adapter may scrape a streaming provider, bypass DRM, or fabricate a file
 * URL from metadata. `inspect()` is optional and must degrade to
 * `status: 'unknown'` rather than inventing an answer.
 */
import type { DownloadInspection, MediaKind, SourceAdapterDescriptor } from '@blaxkvault/shared';

export interface InspectionContext {
  title?: string;
  year?: number;
  kind?: MediaKind;
  tmdbId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface SourceAdapter {
  id: string;
  label: string;
  capabilities: SourceAdapterDescriptor['capabilities'];
  /** Doc URL shown in the Sources screen so claims are checkable. */
  docsUrl: string;
  description: string;
  requiresKey?: 'TMDB_API_KEY' | 'WATCHMODE_API_KEY' | null;
  attribution?: string;
  enabled(): boolean;
  inspect?(url: string, ctx: InspectionContext): Promise<DownloadInspection>;
}

export function describeAdapter(adapter: SourceAdapter): SourceAdapterDescriptor {
  return {
    id: adapter.id,
    label: adapter.label,
    capabilities: adapter.capabilities,
    enabled: adapter.enabled(),
    requiresKey: adapter.requiresKey ?? null,
    description: adapter.description,
    attribution: adapter.attribution,
    docsUrl: adapter.docsUrl,
  };
}

/** Media containers the browsers we target can actually play (or that a user
 *  can hand to their own player). Anything else is reported as unsupported. */
export const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv', 'avi', 'mpg', 'mpeg', 'ts', 'm2ts'];
export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav'];
export const BROWSER_PLAYABLE_EXTENSIONS = ['mp4', 'm4v', 'webm', 'ogv', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav'];

export const VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/x-matroska',
  'video/quicktime',
  'video/ogg',
  'video/mpeg',
  'video/x-msvideo',
  'video/mp2t',
];

export const AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-wav'];

export function extensionOf(nameOrUrl: string): string {
  const clean = nameOrUrl.split('?')[0] ?? '';
  const last = clean.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot <= 0) return '';
  return last.slice(dot + 1).toLowerCase();
}

export function isSupportedMediaExtension(ext: string): boolean {
  return SUPPORTED_VIDEO_EXTENSIONS.includes(ext) || SUPPORTED_AUDIO_EXTENSIONS.includes(ext);
}

export function mimeForExtension(ext: string): string | undefined {
  switch (ext) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'mov':
      return 'video/quicktime';
    case 'ogv':
      return 'video/ogg';
    case 'avi':
      return 'video/x-msvideo';
    case 'mpg':
    case 'mpeg':
      return 'video/mpeg';
    case 'ts':
    case 'm2ts':
      return 'video/mp2t';
    case 'mp3':
      return 'audio/mpeg';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
      return 'audio/ogg';
    case 'opus':
      return 'audio/opus';
    case 'wav':
      return 'audio/wav';
    default:
      return undefined;
  }
}
