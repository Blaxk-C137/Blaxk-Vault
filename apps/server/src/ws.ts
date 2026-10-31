/**
 * Realtime channel.
 *
 * One WebSocket at /ws carries every live update the UI needs: job progress,
 * queue snapshots, library scan results and system stats. Progress events are
 * coalesced on a short timer so a fast download cannot flood the socket (§10).
 *
 * Clients never receive paths they could not already fetch over REST, and never
 * receive a secret. Snapshot messages let a reconnecting client resynchronise
 * without replaying every delta.
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { ServerEvent, SystemStats } from '@blaxkvault/shared';
import { log } from './logger.js';
import { assertAuthorized } from './security/auth.js';
import type { DownloadManager } from './engine/manager.js';

interface Client {
  socket: WebSocket;
  alive: boolean;
}

const WS_ROUTE = '/ws';

export class RealtimeHub {
  private clients = new Set<Client>();
  private heartbeat: NodeJS.Timeout | null = null;
  private pending: ServerEvent | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private statsProvider: (() => SystemStats) | null = null;

  constructor(private manager: DownloadManager) {}

  attach(app: FastifyInstance, statsProvider: () => SystemStats): void {
    this.statsProvider = statsProvider;

    app.get(WS_ROUTE, { websocket: true }, (socket: WebSocket, request) => {
      try {
        // The auth hook covers HTTP routes; the WebSocket upgrade needs its own check.
        assertAuthorized(request as never);
      } catch {
        socket.close(4401, 'Access token required.');
        return;
      }

      const client: Client = { socket, alive: true };
      this.clients.add(client);
      log.debug('ws.client-connected', { clients: this.clients.size });

      socket.on('pong', () => {
        client.alive = true;
      });
      socket.on('message', (raw) => {
        // The only inbound command is a resync request; everything else is ignored.
        try {
          const parsed = JSON.parse(raw.toString()) as { type?: string };
          if (parsed.type === 'resync') this.sendTo(client, this.snapshotEvent());
        } catch {
          /* ignore malformed frames */
        }
      });
      socket.on('close', () => {
        this.clients.delete(client);
      });
      socket.on('error', () => {
        this.clients.delete(client);
        try {
          socket.close();
        } catch {
          /* already closed */
        }
      });

      this.sendTo(client, this.snapshotEvent());
      this.sendTo(client, this.statsEvent());
    });

    this.manager.on('event', (event: ServerEvent) => this.broadcast(event));
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          try {
            client.socket.terminate();
          } catch {
            /* ignore */
          }
          this.clients.delete(client);
          continue;
        }
        client.alive = false;
        try {
          client.socket.ping();
        } catch {
          /* ignore */
        }
      }
      if (this.statsProvider) this.broadcast(this.statsEvent());
    }, 30_000);
    this.heartbeat.unref?.();
  }

  private snapshotEvent(): ServerEvent {
    return { type: 'jobs.snapshot', at: new Date().toISOString(), jobs: this.manager.list() };
  }

  private statsEvent(): ServerEvent {
    const stats: SystemStats = this.statsProvider
      ? this.statsProvider()
      : {
          queued: 0,
          active: 0,
          completed: 0,
          failed: 0,
          totalSpeedBps: 0,
          bytesDownloadedToday: 0,
          libraryItems: 0,
          libraryBytes: 0,
          disk: { path: '' },
        };
    return { type: 'stats', at: new Date().toISOString(), stats };
  }

  private sendTo(client: Client, event: ServerEvent): void {
    if (client.socket.readyState !== 1) return; // OPEN
    try {
      client.socket.send(JSON.stringify(event));
    } catch (err) {
      log.debug('ws.send-failed', { message: (err as Error).message });
    }
  }

  /** Coalesce bursts: at most one flush per 250 ms carrying the latest event. */
  broadcast(event: ServerEvent): void {
    this.pending = event;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const payload = this.pending;
      this.pending = null;
      if (!payload) return;
      for (const client of this.clients) this.sendTo(client, payload);
    }, 250);
    this.flushTimer.unref?.();
  }

  broadcastRaw(event: ServerEvent): void {
    for (const client of this.clients) this.sendTo(client, event);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const client of this.clients) {
      try {
        client.socket.close(1001, 'Server shutting down');
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }
}
