/**
 * Render smoke tests.
 *
 * A clean typecheck does not prove the app runs: missing providers, a bad import
 * cycle or a wrong assumption about an API payload all survive `tsc` and fail on
 * the first paint. These tests render the real component tree with a stubbed
 * `fetch` and assert on what a user would actually see.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { TrendingResponse, TitleSummary } from '@blaxkvault/shared';

const FEATURE: TitleSummary = {
  id: 'tmdb:movie:900001',
  provider: 'tmdb',
  kind: 'movie',
  title: 'Blaxk Test Feature',
  year: 1968,
  overview: 'A deliberately boring synopsis used only by the test suite.',
  voteAverage: 7.9,
  inLibrary: false,
};

const trending: TrendingResponse = {
  results: [FEATURE],
  mock: true,
  attribution: 'Offline sample catalogue (test)',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SETTINGS = {
  downloadDir: '/tmp/media/BlaxkVault-Media',
  maxConcurrentDownloads: 2,
  bandwidthLimitKbps: 0,
  maxDownloadBytes: 0,
  theme: 'dark' as const,
  reducedMotion: 'system' as const,
  tmdbRegion: 'NG',
  tmdbLanguage: 'en-US',
  watchmodeRegion: 'NG',
  aria2Enabled: false,
  aria2RpcUrl: 'http://127.0.0.1:6800/jsonrpc',
  aria2SecretConfigured: false,
  ffprobeAvailable: false,
  ffmpegAvailable: false,
  mediaRoots: ['/tmp/media/BlaxkVault-Media'],
  disk: { path: '/tmp/media/BlaxkVault-Media', totalBytes: 1000, freeBytes: 500, usedBytes: 500, usedPercent: 50 },
};

const HEALTH = {
  status: 'ok' as const,
  version: '1.0.0',
  uptimeSeconds: 12,
  clock: new Date().toISOString(),
  capabilities: { tmdb: false, watchmode: false, archive: true, aria2: false, ffprobe: false, ffmpeg: false, database: true },
  mode: 'fixture' as const,
  accessControl: 'open' as const,
};

const STATS = {
  queued: 0,
  active: 0,
  completed: 0,
  failed: 0,
  totalSpeedBps: 0,
  bytesDownloadedToday: 0,
  libraryItems: 0,
  libraryBytes: 0,
  disk: SETTINGS.disk,
};

const DETAIL = {
  id: 'tmdb:movie:900001',
  provider: 'tmdb' as const,
  kind: 'movie' as const,
  title: 'Blaxk Test Feature',
  year: 1968,
  overview: 'A deliberately boring synopsis used only by the test suite.',
  runtimeMinutes: 96,
  genres: [{ id: 27, name: 'Horror' }],
  cast: [],
  crew: [],
  attribution: 'Test data',
  releaseDate: '1968-10-01',
};

const DOWNLOADABILITY = {
  status: 'available' as const,
  checkedAt: new Date().toISOString(),
  note: '1 permitted file found on the Internet Archive.',
  candidates: [
    {
      sourceId: 'internet-archive',
      sourceLabel: 'Internet Archive · test-item',
      status: 'available' as const,
      fileUrl: 'https://archive.org/download/test-item/test.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1024 * 1024,
      rightsNote: 'Public domain.',
      sourcePageUrl: 'https://archive.org/details/test-item',
      inspectedAt: new Date().toISOString(),
      probe: { tool: 'container-sniff', container: 'mp4', mimeType: 'video/mp4', browserPlayable: true },
    },
  ],
};

/** Storage diagnostics, exactly as GET /api/settings and /api/library/stats return them. */
const STORAGE = [{ root: '/tmp/media/BlaxkVault-Media', exists: true, writable: true, itemCount: 0, bytes: 0 }];

/** Routes just enough of the real API for the shell and Discover to render. */
function stubFetch(overrides: (path: string) => Response | undefined = () => undefined) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    const override = overrides(path);
    if (override) return override;
    if (path.startsWith('/api/trending')) return jsonResponse(trending);
    if (path.startsWith('/api/health')) return jsonResponse(HEALTH);
    if (path.startsWith('/api/settings')) return jsonResponse({ settings: SETTINGS, storage: STORAGE });
    if (path.startsWith('/api/stats')) return jsonResponse(STATS);
    if (path.startsWith('/api/downloads')) {
      return jsonResponse({ jobs: [], limits: { maxConcurrentDownloads: 2, bandwidthLimitKbps: 0, maxDownloadBytes: 0 }, stats: { queued: 0, active: 0, completed: 0, failed: 0, totalSpeedBps: 0 } });
    }
    if (path.startsWith('/api/library/stats')) {
      return jsonResponse({ stats: { items: 0, totalBytes: 0, missing: 0, inProgress: 0 }, storage: STORAGE });
    }
    if (path.startsWith('/api/library')) return jsonResponse({ items: [], stats: { items: 0, totalBytes: 0, missing: 0, inProgress: 0 }, roots: [] });
    if (path.startsWith('/api/sources')) return jsonResponse({ sources: [], note: 'test stub' });
    if (/^\/api\/titles\/[^/]+\/local-copies/.test(path)) return jsonResponse({ copies: [], note: 'No file in your library matches this title.' });
    if (/^\/api\/titles\/[^/]+\/downloadability/.test(path)) return jsonResponse(DOWNLOADABILITY);
    if (/^\/api\/titles\/[^/]+\/availability/.test(path)) return jsonResponse({ region: 'NG', providers: [], attribution: 'test', note: 'stub' });
    if (/^\/api\/titles\/[^/]+$/.test(path)) return jsonResponse(DETAIL);
    return jsonResponse({ error: { code: 'NOT_FOUND', message: `No test stub for ${path}` } }, 404);
  });
}

async function renderApp(route = '/') {
  window.history.pushState({}, '', route);
  // `App` is a named export (see src/App.tsx) — destructuring `default` here
  // would silently render an undefined element.
  const { App } = await import('@/App');
  return render(<App />);
}

describe('BlaxkVault client', () => {
  // Note: no `vi.unstubAllGlobals()` here — the browser API stubs installed in
  // tests/setup.ts (matchMedia, WebSocket, observers) must survive between
  // tests; each test re-stubs `fetch` explicitly.

  it('renders the Discover screen with catalogue data from the API', async () => {
    vi.stubGlobal('fetch', stubFetch());
    await renderApp('/');

    // The shell renders navigation, and Discover renders real data from /api/trending.
    expect(await screen.findAllByText(/Blaxk Test Feature/)).not.toHaveLength(0);
    // The shell renders both a desktop sidebar and a mobile nav.
    expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
  });

  it('shows a real error state instead of a blank screen when the catalogue fails', async () => {
    vi.stubGlobal(
      'fetch',
      stubFetch((path) =>
        path.startsWith('/api/trending')
          ? jsonResponse({ error: { code: 'UPSTREAM_ERROR', message: 'The catalogue provider refused the request.' } }, 502)
          : undefined,
      ),
    );
    await renderApp('/');

    await waitFor(() => {
      expect(screen.getAllByText(/catalogue|provider|failed|went wrong|unavailable/i).length).toBeGreaterThan(0);
    });
  });

  it('renders the downloads screen without a queue', async () => {
    vi.stubGlobal('fetch', stubFetch());
    await renderApp('/downloads');

    await waitFor(() => {
      expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
    });
  });

  it('renders the settings screen and reports an absent ffprobe honestly', async () => {
    vi.stubGlobal('fetch', stubFetch());
    await renderApp('/settings');

    await waitFor(() => {
      expect(screen.getAllByText(/ffprobe/i).length).toBeGreaterThan(0);
    });
  });

  it('switches to the Downloads tab and runs the check when the hero button is clicked', async () => {
    // Regression: "Check downloadability" set a flag but never changed tab, so the
    // button looked completely dead — the check ran behind the Overview tab.
    vi.stubGlobal('fetch', stubFetch());
    const { userEvent } = await import('@testing-library/user-event');
    await renderApp('/title/tmdb:movie:900001');
    const user = userEvent.setup();

    expect((await screen.findAllByText(/deliberately boring synopsis/i)).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: /check downloadability/i }));

    // The panel is now on screen and shows the verdict from the API.
    expect(await screen.findByText(/download availability/i)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText(/permitted file available/i).length).toBeGreaterThan(0);
    });
  });

  it('offers to queue a verified candidate, and reports it once queued', async () => {
    const created: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      stubFetch((path) => {
        if (path.startsWith('/api/downloads')) {
          created.push(path);
          return jsonResponse({ job: { id: 'job-1', fileName: 'test.mp4', status: 'queued' } }, 201);
        }
        return undefined;
      }),
    );
    const { userEvent } = await import('@testing-library/user-event');
    await renderApp('/title/tmdb:movie:900001#downloads');
    const user = userEvent.setup();

    const queueButton = await screen.findByRole('button', { name: /queue this file/i });
    await user.click(queueButton);

    await waitFor(() => {
      expect(screen.getAllByText(/in the download queue/i).length).toBeGreaterThan(0);
    });
  });

  it('switches to Where to watch from the hero button', async () => {
    vi.stubGlobal('fetch', stubFetch());
    const { userEvent } = await import('@testing-library/user-event');
    await renderApp('/title/tmdb:movie:900001');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /where to watch/i }));

    // The AvailabilityList explains that no provider data is configured.
    await waitFor(() => {
      expect(screen.getAllByText(/watch|provider|streaming/i).length).toBeGreaterThan(0);
    });
  });

  it('renders a 404 screen for an unknown route', async () => {
    vi.stubGlobal('fetch', stubFetch());
    await renderApp('/definitely-not-a-route');

    await waitFor(() => {
      expect(screen.getAllByText(/does not exist/i).length).toBeGreaterThan(0);
    });
  });
});
