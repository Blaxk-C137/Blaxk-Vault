/**
 * Offline library list.
 *
 * Every row states what is actually known: real size, real modified date,
 * probe results (container/codec/resolution/duration) when available, subtitle
 * sidecars that exist on disk, playback position, and missing-file warnings.
 * Unsupported codecs are explained instead of hidden.
 */
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, FileVideo, HardDrive, Languages, Play, SearchX } from 'lucide-react';
import type { LibraryItem } from '@blaxkvault/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBytes, formatRuntime, relativeTime } from '@/lib/format';

export function LibraryList({ items }: { items: LibraryItem[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title="Nothing in the library yet"
        description="Downloaded files land here automatically once a transfer completes. You can also point BlaxkVault at folders you already own via Settings → Media roots, then rescan."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/">Find something to download</Link>
          </Button>
        }
      />
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="surface flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center">
          <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-secondary/50 text-muted-foreground">
            <FileVideo className="size-5" aria-hidden />
          </span>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-medium">{item.title}</h3>
              {item.year ? <Badge variant="neutral">{item.year}</Badge> : null}
              {item.kind === 'tv' && item.seasonNumber !== undefined && item.episodeNumber !== undefined ? (
                <Badge variant="outline">
                  S{String(item.seasonNumber).padStart(2, '0')}E{String(item.episodeNumber).padStart(2, '0')}
                </Badge>
              ) : null}
              {item.kind === 'other' ? <Badge variant="neutral">Unclassified</Badge> : null}
              {item.subtitleTracks.length > 0 ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="neutral" className="gap-1">
                      <Languages className="size-3" aria-hidden />
                      {item.subtitleTracks.length}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    Subtitles: {item.subtitleTracks.map((track) => track.label).join(', ')}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              {item.missing ? (
                <Badge variant="danger" className="gap-1">
                  <AlertTriangle className="size-3" aria-hidden />
                  Missing from disk
                </Badge>
              ) : null}
            </div>

            <p className="truncate text-xs text-muted-foreground" title={item.relativePath}>
              {item.relativePath}
            </p>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
              <span className="inline-flex items-center gap-1">
                <HardDrive className="size-3" aria-hidden />
                {formatBytes(item.sizeBytes)}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden />
                {relativeTime(item.modifiedAt)}
              </span>
              {item.probe?.durationSeconds ? <span>{formatRuntime(item.probe.durationSeconds / 60)}</span> : null}
              {item.probe?.width && item.probe?.height ? (
                <span>
                  {item.probe.width}×{item.probe.height}
                </span>
              ) : null}
              {item.probe?.videoCodec ? <span>{item.probe.videoCodec.toUpperCase()}</span> : null}
              <span className="opacity-70">probe: {item.probe?.tool ?? 'not run'}</span>
            </div>

            {item.unsupportedReason ? (
              <p className="flex items-start gap-2 text-xs leading-relaxed text-status-paused">
                <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                {item.unsupportedReason}
              </p>
            ) : null}

            {item.inProgress ? (
              <div className="max-w-sm space-y-1 pt-1">
                <Progress value={35} className="opacity-70" aria-label="Partially watched" />
                <p className="text-[11px] text-muted-foreground">Playback position remembered — the player resumes where you stopped.</p>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {item.missing ? (
              <Button size="sm" variant="outline" disabled>
                File missing
              </Button>
            ) : (
              <Button size="sm" asChild>
                <Link to={`/watch/${item.id}`}>
                  <Play className="size-3.5" aria-hidden />
                  Play
                </Link>
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
