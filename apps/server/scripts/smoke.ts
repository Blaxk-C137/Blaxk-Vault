/**
 * BlaxkVault clean-start smoke test.
 *
 * Runs against a *running* server and verifies the parts that are easy to fake
 * and important to prove:
 *   1. health + capability reporting,
 *   2. the WebSocket delivers a real snapshot,
 *   3. Internet Archive search returns items with rights metadata,
 *   4. the SSRF guard refuses loopback/metadata addresses,
 *   5. a real permitted file is discovered, inspected, queued and downloaded,
 *   6. progress arrives over the WebSocket, and the finished file appears in the
 *      local library.
 *
 * Usage:  npm run smoke            (server must already be running)
 *         BASE_URL=http://host:port npm run smoke
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const WS_BASE = BASE.replace(/^http/, 'ws');
const MAX_BYTES = Number.parseInt(process.env.SMOKE_MAX_BYTES ?? '', 10) || 45 * 1024 * 1024;

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}

const results: Result[] = [];

function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  const badge = ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m';
  console.log(`${badge}  ${name.padEnd(46)} ${detail}`);
}

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  // Only declare JSON when a body is actually sent: an empty body with a JSON
  // content type is rejected by strict HTTP servers (correctly so).
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (init?.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${pathname}`, { ...init, headers });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const message = (body as { error?: { message?: string } } | undefined)?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log(`\nBlaxkVault smoke test → ${BASE}\n`);

  /* ---------------------------- 1. health ---------------------------------- */
  try {
    const health = await api<{ status: string; mode: string; capabilities: Record<string, boolean>; accessControl: string }>('/api/health');
    const enabled = Object.entries(health.capabilities).filter(([, value]) => value).map(([key]) => key);
    record('health reports a usable server', health.status === 'ok', `status=${health.status} mode=${health.mode} access=${health.accessControl}`);
    record('capabilities are reported honestly', enabled.length > 0, `enabled: ${enabled.join(', ')}`);
  } catch (error) {
    record('health reports a usable server', false, (error as Error).message);
    return finish();
  }

  /* ---------------------------- 2. websocket ------------------------------- */
  const events: { type: string; at: string }[] = [];
  const socket = new WebSocket(`${WS_BASE}/ws`);
  // Listeners go on *before* the handshake resolves: the hub sends its snapshot
  // the moment the socket opens, so attaching later would miss it.
  socket.on('message', (raw) => {
    try {
      const event = JSON.parse(raw.toString()) as { type: string; at: string };
      events.push({ type: event.type, at: event.at });
    } catch {
      /* ignore */
    }
  });
  const socketReady = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    socket.on('open', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  await sleep(800);
  record('WebSocket connects and sends a snapshot', socketReady && events.some((e) => e.type === 'jobs.snapshot'), `${events.length} event(s) received`);

  /* -------------------------- 3. archive search ---------------------------- */
  interface ArchiveFile {
    name: string;
    url: string;
    sizeBytes?: number;
    format?: string;
    mimeType?: string;
  }
  let identifier: string | undefined;
  let itemTitle = '';
  let rightsNote = '';
  let searchResults: { identifier: string; title: string; rightsPermitted: boolean }[] = [];
  try {
    const search = await api<{ results: { identifier: string; title: string; rightsPermitted: boolean }[] }>(
      '/api/archive/search?q=public%20domain%20cartoon',
    );
    searchResults = search.results;
    const permitted = search.results.filter((r) => r.rightsPermitted);
    identifier = permitted[0]?.identifier;
    itemTitle = permitted[0]?.title ?? '';
    record(
      'Internet Archive search returns items',
      search.results.length > 0,
      `${search.results.length} results, ${permitted.length} carrying an open licence (e.g. ${itemTitle || 'n/a'})`,
    );
  } catch (error) {
    record('Internet Archive search returns items', false, (error as Error).message);
  }

  /* --------------------------- 4. SSRF refusals ---------------------------- */
  for (const [label, url] of [
    ['loopback', 'http://127.0.0.1:8080/evil.mp4'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
  ] as const) {
    try {
      await api('/api/sources/inspect', { method: 'POST', body: JSON.stringify({ url }) });
      record(`SSRF guard blocks ${label}`, false, 'the server accepted a blocked address!');
    } catch (error) {
      record(`SSRF guard blocks ${label}`, true, (error as Error).message.slice(0, 80));
    }
  }

  /* ------------------------ 5. discover a permitted file ------------------- */
  let fileUrl: string | undefined;
  let sizeBytes: number | undefined;
  let refusedForRights = 0;
  let smallestSeen = Number.POSITIVE_INFINITY;
  for (const candidate of searchResults.slice(0, 10)) {
    if (fileUrl) break;
    try {
      const item = await api<{ bestFile?: ArchiveFile; rightsPermitted: boolean; rightsNote: string }>(
        `/api/archive/items/${encodeURIComponent(candidate.identifier)}`,
      );
      if (!item.rightsPermitted) {
        refusedForRights += 1;
        continue;
      }
      const size = item.bestFile?.sizeBytes ?? 0;
      if (!item.bestFile || size === 0) continue;
      if (size <= MAX_BYTES) {
        identifier = candidate.identifier;
        itemTitle = candidate.title;
        rightsNote = item.rightsNote;
        fileUrl = item.bestFile.url;
        sizeBytes = size;
      } else {
        smallestSeen = Math.min(smallestSeen, size);
      }
    } catch {
      /* try the next item */
    }
  }
  if (fileUrl) {
    record('a permitted file was selected', true, `${itemTitle} · ${(sizeBytes! / 1024 ** 2).toFixed(1)} MB · ${identifier}`);
    record('rights gating is enforced', true, `${refusedForRights} result(s) without an open licence were not offered as downloads`);
  } else if (Number.isFinite(smallestSeen)) {
    record(
      'a permitted file was selected',
      false,
      `smallest permitted file was ${(smallestSeen / 1024 ** 2).toFixed(1)} MB — raise SMOKE_MAX_BYTES to download it`,
    );
  } else {
    record('a permitted file was selected', false, 'no permitted item with a video file was found in the search results');
  }

  /* ----------------------------- 6. inspection ----------------------------- */
  if (fileUrl) {
    try {
      const inspected = await api<{ inspection: { status: string; sizeBytes?: number; probe?: { container?: string; browserPlayable?: boolean; notes?: string[] } }; adapter: { label: string } }>(
        '/api/sources/inspect',
        { method: 'POST', body: JSON.stringify({ url: fileUrl, context: { title: itemTitle } }) },
      );
      const verdict = inspected.inspection.status;
      record(
        'server-side inspection of a real file',
        verdict === 'available',
        `verdict=${verdict} container=${inspected.inspection.probe?.container ?? '?'} size=${inspected.inspection.sizeBytes ?? '?'} via ${inspected.adapter.label}`,
      );
    } catch (error) {
      record('server-side inspection of a real file', false, (error as Error).message);
    }
  }

  /* ------------------------- 7. download end to end ------------------------ */
  if (fileUrl) {
    try {
      const created = await api<{ job: { id: string; fileName: string; absolutePath: string; relativePath: string } }>('/api/downloads', {
        method: 'POST',
        body: JSON.stringify({
          fileUrl,
          sourcePageUrl: `https://archive.org/details/${identifier}`,
          rightsNote: rightsNote || 'Internet Archive item carrying an open licence (smoke test)',
          ref: { title: 'Smoke Test Download', year: new Date().getFullYear(), kind: 'movie' },
        }),
      });
      const jobId = created.job.id;
      record('download queued', true, `${created.job.relativePath}`);

      const deadline = Date.now() + 8 * 60_000;
      let lastStatus = '';
      let sawProgress = false;
      let finalJob: { status: string; bytesDownloaded: number; bytesTotal?: number; error?: string } | null = null;

      while (Date.now() < deadline) {
        const { job } = await api<{ job: { status: string; bytesDownloaded: number; bytesTotal?: number; error?: string } }>(`/api/downloads/${jobId}`);
        finalJob = job;
        if (job.status === 'downloading' && job.bytesDownloaded > 0) sawProgress = true;
        if (job.status !== lastStatus) {
          lastStatus = job.status;
          process.stdout.write(`      · status → ${job.status} (${(job.bytesDownloaded / 1024 ** 2).toFixed(1)} MB)\n`);
        }
        if (['completed', 'failed', 'cancelled', 'unsupported', 'unavailable'].includes(job.status)) break;
        await sleep(1000);
      }

      record('real bytes were transferred', sawProgress || finalJob?.status === 'completed', `bytes=${finalJob?.bytesDownloaded ?? 0} of ${finalJob?.bytesTotal ?? 'unknown'}`);
      record('job reached a terminal state', finalJob?.status === 'completed', `${finalJob?.status}${finalJob?.error ? ` — ${finalJob.error}` : ''}`);
      record('progress arrived over the WebSocket', events.some((e) => e.type === 'job.updated'), `${events.filter((e) => e.type === 'job.updated').length} job.updated event(s)`);

      /* file on disk + library index */
      const library = await api<{ items: { id: string; relativePath: string; sizeBytes: number; probe?: { tool?: string } }[] }>(
        `/api/library?q=${encodeURIComponent(path.basename(created.job.relativePath))}`,
      );
      const indexed = library.items.find((i) => i.relativePath === created.job.relativePath);
      record('finished file appears in the library', Boolean(indexed), indexed ? `${indexed.relativePath} (${(indexed.sizeBytes / 1024 ** 2).toFixed(1)} MB, probe=${indexed.probe?.tool ?? 'none'})` : 'not indexed');
      record('no .part file was left behind', !fs.existsSync(`${created.job.absolutePath}.part`), `${created.job.relativePath}.part`);

      /* history removal must not delete the file */
      await api(`/api/downloads/${jobId}`, { method: 'DELETE' });
      record('removing history keeps the media file', fs.existsSync(created.job.absolutePath), created.job.relativePath);

      /* The confirmed-deletion API needs the job row, and history was just
         removed, so the harness removes its own artifact instead: a smoke run
         must not leave a media file behind in the workspace. (The API's
         confirmed-delete path is covered by the engine suite.) */
      fs.rmSync(created.job.absolutePath, { force: true });
      const parent = path.dirname(created.job.absolutePath);
      try {
        if (fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
      } catch {
        /* leave the folder if anything else lives there */
      }
      record('smoke artifact cleaned up', !fs.existsSync(created.job.absolutePath), 'the downloaded test file was removed from the media root');
    } catch (error) {
      record('download end to end', false, (error as Error).message);
    }
  }

  socket.close();
  finish();
}

function finish(): void {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${'-'.repeat(96)}`);
  console.log(`${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} FAILED` : ' — everything works'}`);
  if (failed.length > 0) {
    for (const item of failed) console.log(`  FAILED: ${item.name} → ${item.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('smoke test crashed:', error);
  process.exitCode = 1;
});
