/**
 * Realtime client.
 *
 * One WebSocket for the whole app. Server events patch the TanStack Query
 * caches directly, so the download manager updates at network speed without
 * polling. Reconnection uses capped exponential backoff; on reconnect the server
 * sends a full snapshot, so a laptop waking from sleep resynchronises instead of
 * showing stale progress.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DownloadJob, ServerEvent } from '@blaxkvault/shared';
import { toast } from 'sonner';
import { queryKeys } from './hooks';

export type ConnectionState = 'connecting' | 'open' | 'closed';

interface JobsCache {
  jobs: DownloadJob[];
  limits: { maxConcurrent: number; bandwidthLimitKbps: number; maxBytes: number };
  stats: unknown;
}

export function useRealtime(enabled = true): { state: ConnectionState; lastEventAt: string | null } {
  const queryClient = useQueryClient();
  const [state, setState] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedByUs = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const token = new URLSearchParams(window.location.search).get('token');
      const url = `${protocol}://${window.location.host}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;
      setState('connecting');

      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        setState('closed');
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        attemptRef.current = 0;
        setState('open');
      };

      socket.onmessage = (message) => {
        let event: ServerEvent;
        try {
          event = JSON.parse(message.data as string) as ServerEvent;
        } catch {
          return;
        }
        setLastEventAt(event.at);

        switch (event.type) {
          case 'jobs.snapshot': {
            queryClient.setQueryData<JobsCache | undefined>(queryKeys.jobs, (previous) => ({
              jobs: event.jobs,
              limits: previous?.limits ?? { maxConcurrent: 1, bandwidthLimitKbps: 0, maxBytes: 0 },
              stats: previous?.stats,
            }));
            break;
          }
          case 'job.updated': {
            queryClient.setQueryData<JobsCache | undefined>(queryKeys.jobs, (previous) => {
              if (!previous) return previous;
              const exists = previous.jobs.some((job) => job.id === event.job.id);
              return {
                ...previous,
                jobs: exists ? previous.jobs.map((job) => (job.id === event.job.id ? event.job : job)) : [event.job, ...previous.jobs],
              };
            });
            if (event.job.status === 'completed') {
              toast.success(`${event.job.fileName} finished downloading.`, { description: 'It is now in your offline library.' });
              void queryClient.invalidateQueries({ queryKey: ['library'] });
            }
            if (event.job.status === 'failed') {
              toast.error(`${event.job.fileName} failed.`, { description: event.job.error });
            }
            break;
          }
          case 'job.removed': {
            queryClient.setQueryData<JobsCache | undefined>(queryKeys.jobs, (previous) =>
              previous ? { ...previous, jobs: previous.jobs.filter((job) => job.id !== event.jobId) } : previous,
            );
            break;
          }
          case 'library.updated': {
            void queryClient.invalidateQueries({ queryKey: ['library'] });
            break;
          }
          case 'stats': {
            queryClient.setQueryData(queryKeys.stats, event.stats);
            queryClient.setQueryData<JobsCache | undefined>(queryKeys.jobs, (previous) =>
              previous ? { ...previous, stats: event.stats } : previous,
            );
            break;
          }
          case 'notice': {
            if (event.level === 'error') toast.error(event.message);
            else if (event.level === 'warn') toast.warning(event.message);
            break;
          }
          default:
            break;
        }
      };

      socket.onerror = () => {
        // onclose always follows; nothing to do beyond letting the UI show it.
      };

      socket.onclose = () => {
        setState('closed');
        if (closedByUs.current) return;
        attemptRef.current += 1;
        const delay = Math.min(15_000, 800 * 2 ** Math.min(attemptRef.current, 4));
        timer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closedByUs.current = true;
      if (timer) clearTimeout(timer);
      try {
        socketRef.current?.close(1000, 'component unmounted');
      } catch {
        /* ignore */
      }
      socketRef.current = null;
    };
  }, [enabled, queryClient]);

  return { state, lastEventAt };
}

export function requestResync(socket: WebSocket | null): void {
  socket?.send(JSON.stringify({ type: 'resync' }));
}
