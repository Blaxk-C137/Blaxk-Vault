/**
 * Server-side inspection of a direct media URL (blueprint §6, "User-provided
 * direct URLs").
 *
 * What inspection actually does:
 *   1. Rejects unsafe URLs (§9 SSRF guard) before any socket is opened.
 *   2. HEADs the resource (falling back to a ranged GET when a server refuses HEAD).
 *   3. Checks the *reported* MIME type and the filename extension.
 *   4. Sniffs real magic bytes with a 64 KB range request, because headers lie.
 *   5. Reads size and range support, so the UI can show real numbers and the
 *      worker knows whether resume is possible.
 *   6. Refuses HTML pages, playlists, images and anything over the size cap.
 *
 * Nothing here can turn a metadata record into a file: the caller must supply a
 * concrete URL, and the verdict is derived only from what the server actually
 * returned.
 */
import { config } from '../config.js';
import { log } from '../logger.js';
import { AppError, unsupported } from '../lib/errors.js';
import { safeFetch } from '../security/url-guard.js';
import type { DownloadInspection, MediaProbeSummary } from '@blaxkvault/shared';
import { AUDIO_MIME_TYPES, VIDEO_MIME_TYPES, extensionOf, isSupportedMediaExtension, mimeForExtension, type InspectionContext } from '../adapters/types.js';
import { isBrowserPlayable, sniffContainer } from './probe.js';
import { sanitizeFileName } from '../security/paths.js';

export interface InspectOptions {
  sourceId?: string;
  /** Human label used in the returned reason strings. */
  origin?: string;
}

export interface DirectInspection extends DownloadInspection {
  finalUrl: string;
  redirects: string[];
  acceptRanges: boolean;
  fileName: string;
  probe: MediaProbeSummary;
}

function filenameFromHeaders(url: string, headers: Headers): string {
  const disposition = headers.get('content-disposition');
  if (disposition) {
    const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (utf8?.[1]) return decodeURIComponent(utf8[1]);
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    if (plain?.[1]) return plain[1];
  }
  const last = decodeURIComponent(url.split('?')[0]?.split('/').pop() ?? '');
  return last || 'download';
}

function extensionFromUrlOrName(url: string, fileName: string): string {
  const fromName = extensionOf(fileName);
  if (fromName) return fromName;
  return extensionOf(url);
}

export async function inspectDirectUrl(input: string, ctx: InspectionContext, options: InspectOptions = {}): Promise<DirectInspection> {
  const inspectedAt = new Date().toISOString();
  const origin = options.origin ?? 'direct-url';

  // ---- 1. HEAD -----------------------------------------------------------
  let head: { response: Response; finalUrl: string; redirects: string[] } | null = null;
  try {
    head = await safeFetch(input, { method: 'HEAD', headers: { Accept: '*/*' } });
  } catch (err) {
    if (err instanceof AppError && err.code !== 'UPSTREAM_ERROR') throw err; // blocked address etc. — fail loudly
    log.debug('inspect.head-failed', { reason: (err as Error).message });
  }

  // ---- 2. Ranged GET for real bytes (also the fallback when HEAD is refused)
  const rangeEnd = 64 * 1024;
  let ranged: { response: Response; finalUrl: string; redirects: string[] } | null = null;
  let headBytes: Buffer = Buffer.alloc(0);
  try {
    ranged = await safeFetch(input, { method: 'GET', headers: { Range: `bytes=0-${rangeEnd - 1}`, Accept: '*/*' } });
    const buffer = Buffer.from(await ranged.response.arrayBuffer());
    headBytes = buffer.subarray(0, rangeEnd);
    // Drain the rest of a misbehaving server that ignored Range and sent more.
    ranged.response.body?.cancel().catch(() => undefined);
  } catch (err) {
    if (!head) throw err;
    log.debug('inspect.range-failed', { reason: (err as Error).message });
  }

  const source = ranged ?? head;
  if (!source) throw unsupported('The server at that URL did not respond to a HEAD or ranged GET request.');

  const headers = source.response.headers;
  const finalUrl = source.finalUrl;
  const redirectedFrom = source.redirects.length > 0 ? source.redirects[0] : undefined;

  // A ranged GET that returns 200 means the server ignored Range (full body).
  const acceptRanges =
    ranged?.response.status === 206 ||
    (headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes');

  const declaredType = (headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const fileName = sanitizeFileName(filenameFromHeaders(finalUrl, headers), 'media');
  const extension = extensionFromUrlOrName(finalUrl, fileName);
  const sniff = headBytes.length > 0 ? sniffContainer(headBytes) : { container: 'unknown', mimeType: undefined, notes: ['No bytes were received.'] };

  const contentLengthHeader = headers.get('content-length');
  let sizeBytes: number | undefined;
  if (contentLengthHeader) {
    const parsed = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(parsed)) {
      // When the whole body was returned for a ranged request, content-length is
      // the real total; when 206 was honoured, content-range carries the total.
      const contentRange = headers.get('content-range');
      const total = contentRange ? /bytes\s+\d+-\d+\/(\d+)/i.exec(contentRange) : null;
      sizeBytes = total?.[1] ? Number.parseInt(total[1], 10) : parsed;
      if (ranged?.response.status === 206 && !contentRange) sizeBytes = undefined; // partial, total unknown
    }
  }

  const videoSniffed = sniff.container === 'mp4' || sniff.container === 'mkv' || sniff.container === 'webm' || sniff.container === 'avi' || sniff.container === 'ogg';
  const audioSniffed = ['mp3', 'flac', 'wav'].includes(sniff.container);
  const mimeLooksMedia =
    VIDEO_MIME_TYPES.some((m) => declaredType.startsWith(m)) ||
    AUDIO_MIME_TYPES.some((m) => declaredType.startsWith(m)) ||
    declaredType === 'application/octet-stream' ||
    declaredType === 'application/x-matroska' ||
    declaredType === 'binary/octet-stream' ||
    declaredType === '';

  const mimeType = declaredType.startsWith('video/') || declaredType.startsWith('audio/') ? declaredType : mimeForExtension(extension) ?? sniff.mimeType;
  const container = sniff.container !== 'unknown' ? sniff.container : extension || mimeType?.split('/')[1];

  const probe: MediaProbeSummary = {
    tool: headBytes.length > 0 ? 'container-sniff' : 'none',
    container,
    mimeType,
    browserPlayable: isBrowserPlayable(container === 'unknown' ? extension : container),
    notes: [
      ...sniff.notes,
      `Server declared: ${declaredType || 'no content-type'}.`,
      acceptRanges ? 'Server supports byte-range requests (pause/resume is safe).' : 'Server does not advertise byte-range support (pause/resume may restart the file).',
      redirectedFrom ? `Redirected from ${new URL(redirectedFrom).host} to ${new URL(finalUrl).host}.` : '',
    ].filter(Boolean),
  };

  const base = {
    sourcePageUrl: ctx.title ? `${options.origin ?? origin}` : finalUrl,
    inspectedBy: origin,
    inspectedAt,
    finalUrl,
    redirects: source.redirects,
    acceptRanges,
    fileName,
    probe,
  };

  // ---- 3. Verdicts -------------------------------------------------------
  if (sniff.container === 'html' || declaredType === 'text/html') {
    return {
      ...base,
      status: 'unsupported',
      sourcePageUrl: finalUrl,
      reason:
        'That URL returns an HTML web page, not a media file. BlaxkVault never guesses a file location out of a page, and it does not scrape streaming providers. Open the page, find the provider\'s own download or offline option, or paste a direct file URL.',
    };
  }

  // Playlist detection runs first: an HLS/DASH manifest is served as
  // application/vnd.apple.mpegurl (or application/dash+xml), so a generic
  // "application/* is not media" branch would give a far less useful answer.
  const playlistLike = /\.(m3u8|mpd|m3u)$/i.test(finalUrl) || declaredType.includes('mpegurl') || declaredType.includes('dash+xml');
  if (playlistLike) {
    return {
      ...base,
      status: 'unsupported',
      sourcePageUrl: finalUrl,
      reason:
        'That URL is a streaming playlist (HLS/DASH), not a file. Saving it would produce a few kilobytes of text, not the video, and fetching its segments would mean circumventing how the provider delivers the stream.',
    };
  }

  if (declaredType.startsWith('application/') && !mimeLooksMedia) {
    return {
      ...base,
      status: 'unsupported',
      sourcePageUrl: finalUrl,
      reason: `The server returned "${declaredType}", which is not a video or audio file.`,
    };
  }

  const extensionSupported = isSupportedMediaExtension(extension);
  const sniffSupported = videoSniffed || audioSniffed;
  if (!extensionSupported && !sniffSupported) {
    return {
      ...base,
      status: 'unsupported',
      sourcePageUrl: finalUrl,
      reason: `The resource looks like a ".${extension || 'unknown'}" file${mimeType ? ` (${mimeType})` : ''}, which BlaxkVault cannot verify as a supported media container.`,
    };
  }
  if (!mimeLooksMedia && !sniffSupported) {
    return {
      ...base,
      status: 'unsupported',
      sourcePageUrl: finalUrl,
      reason: `The server claimed "${declaredType || 'an unknown type'}" and the first bytes did not match a known media container, so this download was refused.`,
    };
  }

  if (config.download.maxBytes > 0 && sizeBytes !== undefined && sizeBytes > config.download.maxBytes) {
    return {
      ...base,
      status: 'unsupported',
      sourcePageUrl: finalUrl,
      sizeBytes,
      reason: `The file is ${sizeBytes} bytes, which is larger than the configured MAX_DOWNLOAD_BYTES limit.`,
    };
  }

  return {
    ...base,
    status: 'available',
    sourcePageUrl: finalUrl,
    fileUrl: finalUrl,
    mimeType,
    sizeBytes,
    rightsNote:
      'You supplied this direct link and confirmed you are authorised to download it. BlaxkVault verified only that it is a real media file — it cannot verify your rights to the content.',
  };
}
