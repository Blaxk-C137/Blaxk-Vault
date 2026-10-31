/**
 * Optional aria2 engine adapter (blueprint §2/§9).
 *
 * aria2 is used only when DOWNLOAD_ENGINE=aria2 AND the RPC endpoint answers.
 * Security posture:
 *   - The RPC URL is validated to be loopback-only, and the settings API
 *     enforces the same rule, so a browser can never be pointed at a remote RPC.
 *   - ARIA2_RPC_SECRET is sent as `token:` in every call and is never returned
 *     by the API (settings expose `aria2SecretConfigured: boolean` only).
 *   - aria2's own JSON-RPC is never exposed to clients: the browser talks to our
 *     authenticated REST/WebSocket API only.
 *
 * If aria2 is not reachable the manager falls back to the native worker and
 * records why, rather than silently failing.
 */
import { config } from '../config.js';
import { log } from '../logger.js';

interface Aria2Response<T> {
  id: string;
  jsonrpc: string;
  result?: T;
  error?: { code: number; message: string };
}

let cachedVersion: { value: string | null; at: number } | null = null;

function rpcUrlIsLoopback(): boolean {
  try {
    const url = new URL(config.download.aria2RpcUrl);
    return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function call<T>(method: string, params: unknown[] = [], timeoutMs = 8000): Promise<T> {
  if (!rpcUrlIsLoopback()) {
    throw new Error('ARIA2_RPC_URL must point at loopback (127.0.0.1/localhost). Refusing to contact a remote RPC endpoint.');
  }
  const payload: Record<string, unknown> = {
    jsonrpc: '2.0',
    id: `blaxkvault-${Date.now().toString(36)}`,
    method,
    params: config.download.aria2Secret ? [`token:${config.download.aria2Secret}`, ...params] : params,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(config.download.aria2RpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`aria2 RPC responded ${response.status}`);
    const body = (await response.json()) as Aria2Response<T>;
    if (body.error) throw new Error(`aria2 error ${body.error.code}: ${body.error.message}`);
    return body.result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function aria2Version(): Promise<string | null> {
  if (cachedVersion && Date.now() - cachedVersion.at < 15_000) return cachedVersion.value;
  try {
    const result = await call<{ version: string }>('aria2.getVersion');
    cachedVersion = { value: result.version, at: Date.now() };
    return result.version;
  } catch (err) {
    log.debug('aria2.unavailable', { message: (err as Error).message });
    cachedVersion = { value: null, at: Date.now() };
    return null;
  }
}

export async function aria2Available(): Promise<boolean> {
  if (config.download.engine !== 'aria2') return false;
  return (await aria2Version()) !== null;
}

export interface Aria2AddResult {
  gid: string;
  /** Whether this was accepted by aria2's own pause state. */
  paused: boolean;
}

export async function aria2Add(opts: {
  url: string;
  dir: string;
  fileName: string;
  paused: boolean;
  maxBytes: number;
  bandwidthLimitKbps: number;
}): Promise<Aria2AddResult> {
  const options: Record<string, string> = {
    dir: opts.dir,
    out: opts.fileName,
    'auto-file-renaming': 'true',
    'allow-overwrite': 'false',
    'max-connection-per-server': '4',
    'user-agent': 'BlaxkVault/1.0 (personal media manager)',
    'content-disposition-default-utf8': 'true',
    'remote-time': 'true',
  };
  if (opts.bandwidthLimitKbps > 0) options['max-overall-download-limit'] = `${opts.bandwidthLimitKbps}K`;
  if (opts.maxBytes > 0) options['max-download-limit'] = `${opts.maxBytes}B`;

  const gid = await call<string>('aria2.addUri', [[opts.url], options]);
  if (opts.paused) await call('aria2.pause', [gid]).catch(() => undefined);
  return { gid, paused: opts.paused };
}

export interface Aria2Status {
  gid: string;
  status: 'active' | 'waiting' | 'paused' | 'error' | 'complete' | 'removed';
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  errorCode?: string;
  errorMessage?: string;
  files?: { path: string }[];
  verifiedLength?: string;
}

export async function aria2Status(gid: string): Promise<Aria2Status | null> {
  try {
    return await call<Aria2Status>('aria2.tellStatus', [gid, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage', 'files', 'verifiedLength']]);
  } catch (err) {
    log.debug('aria2.status-failed', { gid, message: (err as Error).message });
    return null;
  }
}

export async function aria2StatusMany(gids: string[]): Promise<Aria2Status[]> {
  if (gids.length === 0) return [];
  try {
    return await call<Aria2Status[]>('aria2.tellStatus', [
      gids,
      ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'errorCode', 'errorMessage', 'files'],
    ]);
  } catch {
    return [];
  }
}

export const aria2Controls = {
  pause: (gid: string) => call('aria2.pause', [gid]).catch(() => undefined),
  resume: (gid: string) => call('aria2.unpause', [gid]).catch(() => undefined),
  remove: (gid: string) => call('aria2.remove', [gid]).catch(() => undefined),
  forceRemove: (gid: string) => call('aria2.forceRemove', [gid]).catch(() => undefined),
};

export function aria2ErrorExplanation(code?: string): string {
  switch (code) {
    case '1':
      return 'aria2 reported an unknown error.';
    case '2':
      return 'The remote server did not respond in time (aria2 timeout).';
    case '3':
      return 'The resource was not found (HTTP 404) at the time aria2 requested it.';
    case '4':
      return 'Too many requests — the remote server rate limited aria2 (HTTP 429/503).';
    case '9':
      return 'Not enough disk space for this file.';
    case '13':
      return 'The file already existed and aria2 was configured not to overwrite it.';
    case '16':
      return 'The remote file could not be found or read (authentication or a dead link).';
    case '22':
      return 'The server did not honour HTTP range requests, so aria2 could not resume the file.';
    case '24':
      return 'aria2 could not authorise the request (HTTP 401).';
    default:
      return code ? `aria2 reported error code ${code}.` : 'aria2 reported a failure.';
  }
}

export async function aria2GlobalStat(): Promise<{ downloadSpeed: number; numActive: number; numWaiting: number } | null> {
  try {
    const stat = await call<{ downloadSpeed: string; numActive: string; numWaiting: string }>('aria2.getGlobalStat');
    return {
      downloadSpeed: Number.parseInt(stat.downloadSpeed, 10) || 0,
      numActive: Number.parseInt(stat.numActive, 10) || 0,
      numWaiting: Number.parseInt(stat.numWaiting, 10) || 0,
    };
  } catch {
    return null;
  }
}
