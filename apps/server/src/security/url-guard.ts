/**
 * SSRF defence (blueprint §9).
 *
 * Rules enforced before *any* outbound request that a user can influence
 * (inspection, download, archive item fetch):
 *   1. Scheme must be http or https.
 *   2. No embedded credentials (`https://user:pass@host`).
 *   3. Port must be 80, 443, or >= 1024.
 *   4. Hostname must not be an internal alias (localhost, *.local, *.internal…)
 *      nor a cloud metadata endpoint.
 *   5. Every DNS resolution for the host must be a public address — we resolve
 *      ourselves and check *all* answers, which also defeats DNS rebinding to
 *      the extent a single resolution can.
 *   6. Numeric-encoded IPv4 forms (decimal/octal/hex) are normalised before
 *      the check so `http://2130706433/` cannot sneak past rule 5.
 *   7. Redirects are followed manually and every hop is re-validated.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.js';
import { blocked, badRequest, upstream } from '../lib/errors.js';

const INTERNAL_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const INTERNAL_SUFFIXES = ['.local', '.internal', '.localdomain', '.lan', '.home', '.corp', '.intranet', '.onion'];

const METADATA_ADDRESSES = new Set(['169.254.169.254', '169.254.170.2', '100.100.100.200', 'fd00:ec2::254']);

/** Normalise `0177.0.0.1`, `0x7f.1`, `2130706433` style hosts to dotted quads. */
export function normalizeNumericHost(host: string): string | null {
  const bare = host.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) return bare;
  const parts = bare.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const nums = parts.map((part) => {
    if (part === '') return NaN;
    if (/^0x[0-9a-f]+$/i.test(part)) return Number.parseInt(part, 16);
    if (/^0[0-7]+$/.test(part)) return Number.parseInt(part, 8);
    if (/^\d+$/.test(part)) return Number.parseInt(part, 10);
    return NaN;
  });
  if (nums.some((n) => Number.isNaN(n) || n < 0)) return null;
  const lastIndex = nums.length - 1;
  for (let i = 0; i < lastIndex; i += 1) if (nums[i]! > 255) return null;
  const maxLast = 256 ** (4 - lastIndex);
  if (nums[lastIndex]! >= maxLast) return null;
  let value = nums[lastIndex]!;
  for (let i = 0; i < lastIndex; i += 1) value += nums[i]! * 256 ** (3 - i);
  if (value < 0 || value > 0xffffffff) return null;
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

function ipv4IsPrivate(ip: string): boolean {
  const octets = ip.split('.').map((n) => Number.parseInt(n, 10));
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true; // fail closed
  const [a = 0, b = 0] = octets;
  if (a === 0) return true; // 0.0.0.0/8  "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 88) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && b === 51) return true; // TEST-NET-2
  if (a === 203 && b === 0) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function ipv6IsPrivate(ip: string): boolean {
  const lower = ip.toLowerCase().split('%')[0]!;
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('2001:db8')) return true; // documentation
  // IPv4-mapped / IPv4-compatible forms
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return ipv4IsPrivate(mapped[1]!);
  const compat = /^::(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (compat) return ipv4IsPrivate(compat[1]!);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  if (!config.security.allowPrivateAddresses && METADATA_ADDRESSES.has(ip)) return true;
  if (config.security.allowPrivateAddresses) return false;
  if (net.isIPv4(ip)) return ipv4IsPrivate(ip);
  if (net.isIPv6(ip)) return ipv6IsPrivate(ip);
  return true; // unknown shape → fail closed
}

export interface ResolvedTarget {
  url: URL;
  addresses: string[];
}

/**
 * Validate a URL's shape and, if it has a hostname, resolve it and verify every
 * answer is public. Returns the parsed URL plus the resolved addresses.
 */
export async function assertSafeRemoteUrl(input: string | URL): Promise<ResolvedTarget> {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    throw badRequest('That is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw blocked(`Only http and https URLs can be fetched (received "${url.protocol.replace(':', '')}").`);
  }
  if (url.username || url.password) {
    throw blocked('URLs containing embedded credentials are rejected.');
  }
  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
  if (!(port === 80 || port === 443 || port >= 1024)) {
    throw blocked(`Port ${port} is not permitted for outbound requests.`);
  }

  const hostname = url.hostname.toLowerCase();
  if (INTERNAL_HOSTNAMES.has(hostname) || INTERNAL_SUFFIXES.some((s) => hostname.endsWith(s))) {
    throw blocked('Requests to internal hostnames are blocked.');
  }

  const normalized = normalizeNumericHost(hostname);
  if (normalized && net.isIP(normalized)) {
    if (isBlockedAddress(normalized)) {
      throw blocked(`Address ${normalized} is in a blocked range (loopback, private, link-local or reserved).`);
    }
    return { url, addresses: [normalized] };
  }

  let answers: { address: string; family: number }[];
  try {
    answers = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw upstream(`Could not resolve host "${hostname}".`);
  }
  if (answers.length === 0) throw upstream(`Host "${hostname}" did not resolve to any address.`);

  const addresses = answers.map((a) => a.address);
  const offending = addresses.find((a) => isBlockedAddress(a));
  if (offending) {
    throw blocked(
      `Host "${hostname}" resolves to ${offending}, which is in a blocked range (loopback, private, link-local or reserved).`,
    );
  }

  if (config.security.allowedHttpHosts.length > 0 && !config.security.allowedHttpHosts.includes(hostname)) {
    throw blocked(`Host "${hostname}" is not in ALLOWED_HTTP_HOSTS.`);
  }

  return { url, addresses };
}

export interface SafeFetchResult {
  response: Response;
  finalUrl: string;
  redirects: string[];
}

/**
 * Fetch with manual redirect handling: every hop is re-validated against the
 * SSRF rules before it is requested (§9 — "validate DNS resolutions and every
 * redirect hop"). Timeouts are enforced with AbortSignal.
 */
export async function safeFetch(
  input: string,
  init: RequestInit & { timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult> {
  const { timeoutMs = config.download.connectTimeoutMs, maxRedirects = config.download.maxRedirects, ...rest } = init;
  let current = input;
  const redirects: string[] = [];

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeRemoteUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, { ...rest, redirect: 'manual', signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw upstream(`Request to ${new URL(current).host} timed out after ${timeoutMs} ms.`);
      }
      throw upstream(`Request to ${new URL(current).host} failed: ${(err as Error).message}`);
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw upstream(`Redirect from ${new URL(current).host} had no Location header.`);
      if (hop === maxRedirects) throw upstream(`Too many redirects (limit ${maxRedirects}).`);
      const next = new URL(location, current).toString();
      redirects.push(next);
      current = next;
      continue;
    }

    return { response, finalUrl: current, redirects };
  }
  throw upstream('Too many redirects.');
}
