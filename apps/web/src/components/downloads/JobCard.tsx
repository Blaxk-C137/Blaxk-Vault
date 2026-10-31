/**
 * A single download job.
 *
 * Shows only measured values: bytes written, live speed, ETA from speed, and a
 * percentage only when the server actually reported a total size. When the size
 * is unknown the bar is indeterminate and says so, rather than animating a fake
 * progress. Controls map one-to-one to real engine actions.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Cpu,
  DownloadCloud,
  ExternalLink,
  FileWarning,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { DownloadJob } from '@blaxkvault/shared';
import { DOWNLOAD_STATUS_LABEL } from '@blaxkvault/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useJobMutations } from '@/api/hooks';
import { STATUS_BAR_CLASS, STATUS_CLASS, formatBytes, formatEta, formatSpeed, prettyDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function JobCard({ job }: { job: DownloadJob }) {
  const { pause, resume, cancel, retry, remove, deleteFile } = useJobMutations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const indeterminate = job.bytesTotal === undefined || job.bytesTotal <= 0;
  const percent = indeterminate ? 0 : Math.round(job.progress * 100);
  const busy = pause.isPending || resume.isPending || cancel.isPending || retry.isPending;
  const inFlight = job.status === 'downloading' || job.status === 'queued';

  return (
    <article
      className="surface rounded-xl p-4"
      aria-label={`${job.fileName}, ${DOWNLOAD_STATUS_LABEL[job.status]}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_CLASS[job.status])}>
              {job.status === 'downloading' ? <DownloadCloud className="size-3" aria-hidden /> : null}
              {job.status === 'completed' ? <CheckCircle2 className="size-3" aria-hidden /> : null}
              {job.status === 'failed' ? <AlertTriangle className="size-3" aria-hidden /> : null}
              {DOWNLOAD_STATUS_LABEL[job.status]}
            </span>
            {job.engine === 'aria2' ? (
              <Badge variant="neutral" className="gap-1">
                <Cpu className="size-3" aria-hidden />
                aria2
              </Badge>
            ) : null}
            <Badge variant="outline">{job.sourceId}</Badge>
            {job.rightsNote ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="neutral" className="gap-1">
                    <ShieldCheck className="size-3" aria-hidden />
                    rights noted
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{job.rightsNote}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>

          <h3 className="truncate text-sm font-medium" title={job.fileName}>
            {job.fileName}
          </h3>
          <p className="truncate text-xs text-muted-foreground" title={job.relativePath}>
            {job.ref.title ? `${job.ref.title}${job.ref.year ? ` (${job.ref.year})` : ''}` : job.relativePath}
            {job.ref.seasonNumber !== undefined && job.ref.episodeNumber !== undefined
              ? ` · S${String(job.ref.seasonNumber).padStart(2, '0')}E${String(job.ref.episodeNumber).padStart(2, '0')}`
              : ''}
          </p>
        </div>

        {/* ------------------------------ controls ------------------------------ */}
        <div className="flex flex-wrap items-center gap-1.5">
          {job.status === 'downloading' ? (
            <Button size="sm" variant="outline" onClick={() => pause.mutate(job.id)} disabled={busy}>
              {pause.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Pause className="size-3.5" aria-hidden />}
              Pause
            </Button>
          ) : null}

          {job.status === 'paused' || job.status === 'failed' ? (
            <Button size="sm" variant="outline" onClick={() => resume.mutate(job.id)} disabled={busy}>
              {resume.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
              {job.status === 'failed' ? 'Resume' : 'Continue'}
            </Button>
          ) : null}

          {job.status === 'failed' || job.status === 'cancelled' ? (
            <Button size="sm" variant="outline" onClick={() => retry.mutate(job.id)} disabled={busy}>
              {retry.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="size-3.5" aria-hidden />}
              Retry
            </Button>
          ) : null}

          {inFlight ? (
            <Button size="sm" variant="ghost" onClick={() => cancel.mutate(job.id)} disabled={busy} aria-label={`Cancel ${job.fileName}`}>
              {cancel.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Ban className="size-3.5" aria-hidden />}
              Cancel
            </Button>
          ) : null}

          {job.status === 'completed' ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/library">
                <Play className="size-3.5" aria-hidden />
                Play
              </Link>
            </Button>
          ) : null}

          {job.sourcePageUrl ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" asChild aria-label="Open the source page">
                  <a href={job.sourcePageUrl} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="size-3.5" aria-hidden />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>The page this file came from, with its rights statement</TooltipContent>
            </Tooltip>
          ) : null}

          {!inFlight ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={() => remove.mutate(job.id)} aria-label="Remove from history (keeps the file)">
                  <X className="size-3.5" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove from the queue list. The downloaded file is always kept.</TooltipContent>
            </Tooltip>
          ) : null}

          {job.status === 'completed' ? (
            <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost" className="text-destructive" aria-label="Delete the stored file">
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete the stored file?</DialogTitle>
                  <DialogDescription>
                    This deletes <span className="font-medium text-foreground">{job.relativePath}</span> from disk. Re-downloading may not be
                    possible if the source is gone. Removing an entry from history never deletes files — this dialog does.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Keep the file
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      deleteFile.mutate(job.id);
                      setConfirmDelete(false);
                    }}
                    disabled={deleteFile.isPending}
                  >
                    {deleteFile.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                    Delete file
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
      </div>

      {/* ------------------------------- progress ------------------------------- */}
      {job.status === 'downloading' || job.status === 'paused' || (job.status === 'completed' && !indeterminate) ? (
        <div className="mt-3 space-y-1.5">
          <Progress
            value={indeterminate ? undefined : percent}
            indicatorClassName={cn(STATUS_BAR_CLASS[job.status], indeterminate && 'animate-pulse')}
            aria-label={`Download progress for ${job.fileName}`}
            aria-valuenow={indeterminate ? undefined : percent}
          />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>
              {formatBytes(job.bytesDownloaded)}
              {job.bytesTotal ? ` of ${formatBytes(job.bytesTotal)}` : ' (total size unknown — the server did not send one)'}
            </span>
            {job.status === 'downloading' ? (
              <>
                <span>· {formatSpeed(job.speedBps)}</span>
                <span>· {job.etaSeconds !== undefined ? `${formatEta(job.etaSeconds)} left` : 'ETA unknown'}</span>
              </>
            ) : null}
            {!indeterminate && job.status !== 'downloading' ? <span>· {percent}%</span> : null}
          </div>
        </div>
      ) : null}

      {/* --------------------------------- errors -------------------------------- */}
      {job.error ? (
        <p
          className={cn(
            'mt-3 flex items-start gap-2 rounded-md border p-2.5 text-xs leading-relaxed',
            job.status === 'failed' ? 'border-status-failed/40 bg-status-failed/8' : 'border-border/70 bg-card/50 text-muted-foreground',
          )}
        >
          {job.status === 'failed' ? (
            <FileWarning className="mt-px size-3.5 shrink-0 text-status-failed" aria-hidden />
          ) : (
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          )}
          <span>
            {job.error}
            {job.errorCode ? <span className="ml-1 opacity-70">({job.errorCode})</span> : null}
          </span>
        </p>
      ) : null}

      <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <div className="flex gap-1">
          <dt>Created</dt>
          <dd>{prettyDateTime(job.createdAt)}</dd>
        </div>
        {job.completedAt ? (
          <div className="flex gap-1">
            <dt>Finished</dt>
            <dd>{prettyDateTime(job.completedAt)}</dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt>Attempts</dt>
          <dd>{job.attempts}</dd>
        </div>
        <div className="flex min-w-0 gap-1">
          <dt>Path</dt>
          <dd className="truncate">{job.relativePath}</dd>
        </div>
      </dl>
    </article>
  );
}
