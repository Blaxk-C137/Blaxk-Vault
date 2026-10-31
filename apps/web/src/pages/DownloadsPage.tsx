/**
 * Download manager.
 *
 * Everything on this screen is derived from real engine state delivered over
 * REST and the WebSocket. Filters map to the actual job state machine, and each
 * control maps to a real engine action.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, DownloadCloud, Gauge, Inbox, Loader2, RefreshCw, Server } from 'lucide-react';
import type { DownloadStatus } from '@blaxkvault/shared';
import { PageHeader } from '@/components/app/AppShell';
import { JobCard } from '@/components/downloads/JobCard';
import { QueueLimits } from '@/components/downloads/QueueLimits';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useHealth, useJobs, useStats } from '@/api/hooks';
import { errorMessage } from '@/api/hooks';
import { useRealtime } from '@/api/ws';
import { formatBytes, formatSpeed } from '@/lib/format';

const FILTERS: { value: 'active' | 'all' | 'completed' | 'problems'; label: string; statuses?: DownloadStatus[] }[] = [
  { value: 'active', label: 'Active', statuses: ['queued', 'downloading', 'paused'] },
  { value: 'all', label: 'All' },
  { value: 'completed', label: 'Completed', statuses: ['completed'] },
  { value: 'problems', label: 'Problems', statuses: ['failed', 'cancelled', 'unsupported', 'unavailable'] },
];

export function DownloadsPage() {
  const jobs = useJobs();
  const stats = useStats();
  const health = useHealth();
  const { state } = useRealtime();
  const [filter, setFilter] = useState<'active' | 'all' | 'completed' | 'problems'>('active');

  const all = jobs.data?.jobs ?? [];
  const counts = useMemo(() => {
    const active = all.filter((job) => ['queued', 'downloading', 'paused'].includes(job.status)).length;
    const completed = all.filter((job) => job.status === 'completed').length;
    const problems = all.filter((job) => ['failed', 'cancelled', 'unsupported', 'unavailable'].includes(job.status)).length;
    return { active, completed, problems, all: all.length };
  }, [all]);

  const statuses = FILTERS.find((f) => f.value === filter)?.statuses;
  const visible = statuses ? all.filter((job) => statuses.includes(job.status)) : all;
  const ariaNow = stats.data?.totalSpeedBps ?? 0;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Downloads"
        badge={
          <Badge variant={state === 'open' ? 'success' : 'warning'} className="gap-1">
            {state === 'open' ? 'Live updates' : 'Reconnecting'}
          </Badge>
        }
        description="Real transfers with real measurements. Progress comes from bytes written to disk; when a server does not tell us the file size, BlaxVault says so instead of drawing a fake percentage."
        actions={
          <Button variant="outline" size="sm" onClick={() => jobs.refetch()} disabled={jobs.isFetching}>
            {jobs.isFetching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            Refresh
          </Button>
        }
      />

      {/* -------------------------------- summary -------------------------------- */}
      <section className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Queue summary">
        <div className="surface rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground">Active transfers</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{stats.data?.active ?? 0}</p>
          <p className="text-xs text-muted-foreground">of {jobs.data?.limits.maxConcurrent ?? '—'} allowed at once</p>
        </div>
        <div className="surface rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground">Combined speed</p>
          <p className="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums">
            {formatSpeed(ariaNow)}
            {state === 'open' ? <span className="text-[10px] font-normal uppercase tracking-wider text-status-completed">live</span> : null}
          </p>
          <p className="text-xs text-muted-foreground">
            {(jobs.data?.limits.bandwidthLimitKbps ?? 0) === 0 ? 'No bandwidth limit set' : `Capped at ${jobs.data?.limits.bandwidthLimitKbps} KB/s`}
          </p>
        </div>
        <div className="surface rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground">Downloaded today</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatBytes(stats.data?.bytesDownloadedToday ?? 0)}</p>
          <p className="text-xs text-muted-foreground">{stats.data?.completed ?? 0} completed overall</p>
        </div>
        <div className="surface rounded-xl p-3.5">
          <p className="text-xs text-muted-foreground">Free disk space</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatBytes(stats.data?.disk.freeBytes ?? 0)}</p>
          <p className="truncate text-xs text-muted-foreground" title={stats.data?.disk.path}>
            {stats.data?.disk.path ?? '—'}
          </p>
        </div>
      </section>

      {health.data && !health.data.capabilities.aria2 && health.data.capabilities.database ? (
        <Alert variant="info" className="mb-5">
          <Server />
          <AlertTitle>Using the built-in download worker</AlertTitle>
          <AlertDescription>
            aria2 is not active, so BlaxkVault is using its native worker: HTTP range resume, token-bucket throttling, idle timeouts and disk-full
            detection. Set <span className="font-mono text-xs">DOWNLOAD_ENGINE=aria2</span> plus a localhost RPC secret to switch engines —
            aria2's JSON-RPC is never exposed to the browser.
          </AlertDescription>
        </Alert>
      ) : null}

      {stats.data?.disk.freeBytes !== undefined && stats.data.disk.freeBytes < 2 * 1024 ** 3 ? (
        <Alert variant="warning" className="mb-5">
          <AlertTriangle />
          <AlertTitle>Low disk space</AlertTitle>
          <AlertDescription>
            Only {formatBytes(stats.data.disk.freeBytes)} free. Transfers will stop with a disk-full error and keep their partial files so you can
            resume later.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as typeof filter)}>
            <TabsList className="flex-wrap">
              {FILTERS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                  <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                    {option.value === 'all' ? counts.all : option.value === 'completed' ? counts.completed : option.value === 'problems' ? counts.problems : counts.active}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {jobs.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : jobs.isError ? (
            <EmptyState
              tone="error"
              icon={AlertTriangle}
              title="The queue could not be loaded"
              description={errorMessage(jobs.error)}
              action={
                <Button size="sm" variant="outline" onClick={() => jobs.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              icon={filter === 'completed' ? CheckCircle2 : Inbox}
              title={filter === 'active' ? 'Nothing queued right now' : filter === 'completed' ? 'No completed downloads yet' : 'No items in this filter'}
              description="Open a title, run a downloadability check, and queue any file you are permitted to keep. Direct links you own can be validated from a title's Downloads tab."
              action={
                <div className="flex gap-2">
                  <Button size="sm" asChild>
                    <Link to="/">
                      <DownloadCloud className="size-3.5" aria-hidden />
                      Find a title
                    </Link>
                  </Button>
                  {filter !== 'all' ? (
                    <Button size="sm" variant="outline" onClick={() => setFilter('all')}>
                      Show all jobs
                    </Button>
                  ) : null}
                </div>
              }
            />
          ) : (
            <div className="space-y-3">
              {visible.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          )}
        </div>

        {/* ------------------------------- side rail ------------------------------- */}
        <aside className="space-y-4">
          <QueueLimits />
          <div className="surface rounded-xl p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
              <Gauge className="size-4 text-primary" aria-hidden />
              How these numbers are produced
            </p>
            <ul className="space-y-1.5">
              <li>· Progress counts bytes actually written to the partial file.</li>
              <li>· Speed is a 6-second sliding average of those writes.</li>
              <li>· ETA appears only when the server reported a total size.</li>
              <li>· Pause keeps the partial file; resume continues from that byte offset.</li>
              <li>· Cancel removes the partial file. Removing history never deletes a finished file.</li>
              <li>· Job state is stored in SQLite, and reconciled against disk after a restart.</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
