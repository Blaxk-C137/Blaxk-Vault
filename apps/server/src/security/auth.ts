/**
 * Access control (blueprint §9: "Authenticate any LAN access; no public hosting
 * by default").
 *
 *  - Loopback callers are always allowed (the intended desktop setup).
 *  - When the server is bound beyond loopback, a bearer token is required.
 *    BLAXKVAULT_ACCESS_TOKEN is generated at boot if the operator did not set
 *    one, printed once to the log, and never exposed through the API.
 *  - Only /api/health is public, and it reveals nothing sensitive.
 */
import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config, isExposedBeyondLoopback } from '../config.js';
import { log } from '../logger.js';
import { AppError } from '../lib/errors.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

let runtimeToken: string | null = null;

export function effectiveToken(): string | null {
  return config.accessToken ?? runtimeToken;
}

export function accessControlMode(): 'loopback-only' | 'token-required' | 'open' {
  if (!isExposedBeyondLoopback()) return 'loopback-only';
  if (config.allowUnauthenticated) return 'open';
  return effectiveToken() ? 'token-required' : 'open';
}

export function initAccessControl(): void {
  if (config.allowUnauthenticated) {
    if (isExposedBeyondLoopback()) {
      log.warn(
        'BLAXKVAULT_ALLOW_UNAUTHENTICATED is set: every request is accepted without a token. Use this only behind a trusted local proxy — never on a network untrusted clients can reach.',
      );
    }
    return;
  }
  if (isExposedBeyondLoopback() && !config.accessToken) {
    runtimeToken = crypto.randomBytes(24).toString('base64url');
    // Two short lines an operator can act on, instead of a JSON record they have
    // to parse. The token is the only secret ever logged, and only once, because
    // it cannot be obtained any other way — set it in .env to stop the churn.
    log.warn(`Listening on ${config.host} without BLAXKVAULT_ACCESS_TOKEN — requests need the temporary token below.`);
    log.info(`Temporary access token: ${runtimeToken}`);
    log.info('Add BLAXKVAULT_ACCESS_TOKEN to .env (or set HOST=127.0.0.1) to stop generating one on every start.');
  }
}

export function isLoopbackRequest(req: FastifyRequest): boolean {
  const ip = req.ip ?? '';
  return LOOPBACK.has(ip) || ip.startsWith('127.') || ip === '::1';
}

export function assertAuthorized(req: FastifyRequest): void {
  if (config.allowUnauthenticated) return;
  if (isLoopbackRequest(req)) return;
  const token = effectiveToken();
  if (!token) return; // explicitly open (operator chose no token on a trusted network)
  const header = req.headers.authorization;
  const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const queryToken = typeof (req.query as Record<string, unknown> | undefined)?.token === 'string'
    ? ((req.query as Record<string, unknown>).token as string)
    : null;
  const provided = bearer ?? queryToken;
  if (!provided || !timingSafeEqual(provided, token)) {
    throw new AppError('UNAUTHORIZED', 'A valid access token is required for this request.');
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Fastify onRequest hook factory: skip only for the health endpoint. */
export function makeAuthHook(publicPaths: string[]) {
  return async function authHook(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
    const pathname = req.url.split('?')[0] ?? '';
    if (publicPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return;
    assertAuthorized(req);
  };
}
