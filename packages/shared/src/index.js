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
export const MEDIA_KINDS = ['movie', 'tv'];
export const DOWNLOADABILITY_STATES = ['available', 'unavailable', 'unsupported', 'unknown'];
export const SOURCE_CAPABILITIES = ['metadata', 'availability', 'authorized-download', 'local-library'];
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
];
/** Terminal states never transition again without an explicit retry. */
export const TERMINAL_DOWNLOAD_STATUSES = ['completed', 'failed', 'cancelled', 'unsupported', 'unavailable'];
export const ACTIVE_DOWNLOAD_STATUSES = ['queued', 'downloading', 'paused'];
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
export function formatBytes(bytes, digits = 1) {
    if (bytes === undefined || bytes === null || Number.isNaN(bytes))
        return '—';
    if (bytes < 1024)
        return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(digits)} ${units[unit]}`;
}
export function formatSpeed(bps) {
    if (!bps || bps <= 0)
        return '—';
    return `${formatBytes(bps, 1)}/s`;
}
export function formatEta(seconds) {
    if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds <= 0)
        return '—';
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0)
        return `${h}h ${m}m`;
    if (m > 0)
        return `${m}m ${sec}s`;
    return `${sec}s`;
}
export function formatRuntime(minutes) {
    if (!minutes || minutes <= 0)
        return '—';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h <= 0)
        return `${m}m`;
    return `${h}h ${m}m`;
}
/** Human labels for the four downloadability verdicts, used everywhere. */
export const DOWNLOADABILITY_LABEL = {
    available: 'Permitted file available',
    unavailable: 'No permitted file found',
    unsupported: 'Source not supported',
    unknown: 'Not yet verified',
};
export const DOWNLOAD_STATUS_LABEL = {
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
//# sourceMappingURL=index.js.map