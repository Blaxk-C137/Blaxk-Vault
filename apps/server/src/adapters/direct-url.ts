/**
 * User-supplied direct URL adapter.
 *
 * The user pastes a link to a media file they are authorised to download
 * (their own server, a studio press kit, a Creator Commons release, a
 * self-hosted copy). The adapter runs the full server-side inspection chain and
 * reports exactly what it found. It never assumes a page URL is a file.
 */
import type { DownloadInspection } from '@blaxkvault/shared';
import { inspectDirectUrl } from '../engine/inspect.js';
import type { InspectionContext, SourceAdapter } from './types.js';

export function createDirectUrlAdapter(): SourceAdapter {
  return {
    id: 'direct-url',
    label: 'Direct URL (your own authorised link)',
    capabilities: ['authorized-download'],
    docsUrl: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests',
    description:
      'Paste a direct link to a video or audio file you are authorised to download. BlaxkVault checks the SSRF guard, follows and re-validates every redirect, reads the real MIME type and magic bytes, and reports the honest verdict — including a refusal when the link is an HTML page, a streaming playlist, or a file the server cannot serve.',
    requiresKey: null,
    attribution: 'You are responsible for the rights to any URL you supply.',
    enabled: () => true,
    inspect: async (url: string, ctx: InspectionContext): Promise<DownloadInspection> => {
      const result = await inspectDirectUrl(url, ctx, { origin: 'direct-url' });
      return result;
    },
  };
}
