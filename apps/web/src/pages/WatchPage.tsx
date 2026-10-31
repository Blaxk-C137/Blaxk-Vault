/**
 * Watch — offline playback from the local library.
 *
 * Progress is stored server-side so a second device resumes the same position.
 * A missing file or an unplayable codec is reported as an error with a way
 * forward, never as a spinning player.
 */
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Clock, FileVideo, HardDrive, Languages, RefreshCw, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/app/AppShell';
import { VaultPlayer } from '@/components/library/VaultPlayer';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/api/client';
import { errorMessage, useLibraryItem, useSaveProgress, useScanLibrary } from '@/api/hooks';
import { formatBytes, formatRuntime, prettyDateTime } from '@/lib/format';

export function WatchPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const item = useLibraryItem(id);
  const saveProgress = useSaveProgress();
  const scan = useScanLibrary();

  if (item.isLoading) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="aspect-video w-full rounded-xl" />
      </div>
    );
  }

  if (item.isError || !item.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>That file is not playable from here</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{item.isError ? errorMessage(item.error) : 'Unknown library item.'}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => scan.mutate()}>
                <RefreshCw className="size-3.5" aria-hidden />
                Rescan the library
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/library')}>
                Back to the library
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const libraryItem = item.data.item;
  const progress = item.data.progress;
  const startAt = progress && !progress.completed ? progress.positionSeconds : 0;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        breadcrumb={
          <>
            <Button variant="ghost" size="sm" className="-ml-2 h-7" asChild>
              <Link to="/library">
                <ArrowLeft className="size-3.5" aria-hidden />
                Library
              </Link>
            </Button>
          </>
        }
        title={libraryItem.title}
        badge={
          libraryItem.kind === 'tv' && libraryItem.seasonNumber !== undefined && libraryItem.episodeNumber !== undefined ? (
            <Badge variant="outline">
              S{String(libraryItem.seasonNumber).padStart(2, '0')}E{String(libraryItem.episodeNumber).padStart(2, '0')}
            </Badge>
          ) : undefined
        }
        description={
          progress && !progress.completed && progress.positionSeconds > 5
            ? `Resuming from ${formatRuntime(progress.positionSeconds / 60)} — your position is stored on the server, so it follows you between devices.`
            : 'Playing a file from your local library. Progress is saved every ten seconds.'
        }
      />

      {libraryItem.missing ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>The file is missing from disk</AlertTitle>
          <AlertDescription>
            BlaxkVault remembers this entry, but <span className="font-mono text-xs">{libraryItem.relativePath}</span> is no longer present. Restore
            the file or rescan to clean the index.
          </AlertDescription>
        </Alert>
      ) : (
        <VaultPlayer
          item={libraryItem}
          streamUrl={api.streamUrl(libraryItem.id)}
          startAtSeconds={startAt}
          onSaveProgress={({ positionSeconds, durationSeconds, completed }) =>
            saveProgress.mutate({ id: libraryItem.id, positionSeconds, durationSeconds, completed })
          }
        />
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="surface rounded-xl p-3.5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileVideo className="size-3.5" aria-hidden />
            Container / codec
          </p>
          <p className="mt-1 text-sm">
            {libraryItem.probe?.container ?? libraryItem.extension.toUpperCase()}
            {libraryItem.probe?.videoCodec ? ` · ${libraryItem.probe.videoCodec.toUpperCase()}` : ''}
          </p>
          <p className="text-xs text-muted-foreground">
            {libraryItem.probe?.width ? `${libraryItem.probe.width}×${libraryItem.probe.height}` : 'Resolution unknown'}
            {libraryItem.probe?.tool === 'container-sniff' ? ' · ffprobe not installed' : ''}
          </p>
        </div>

        <div className="surface rounded-xl p-3.5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <HardDrive className="size-3.5" aria-hidden />
            File
          </p>
          <p className="mt-1 text-sm tabular-nums">{formatBytes(libraryItem.sizeBytes)}</p>
          <p className="truncate text-xs text-muted-foreground" title={libraryItem.relativePath}>
            {libraryItem.relativePath}
          </p>
        </div>

        <div className="surface rounded-xl p-3.5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Languages className="size-3.5" aria-hidden />
            Subtitles
          </p>
          <p className="mt-1 text-sm">
            {libraryItem.subtitleTracks.length === 0 ? 'None found' : `${libraryItem.subtitleTracks.length} track(s)`}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {libraryItem.subtitleTracks.map((track) => track.label).join(', ') || 'Add a .vtt or .srt next to the video file and rescan'}
          </p>
        </div>

        <div className="surface rounded-xl p-3.5">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" aria-hidden />
            Indexed
          </p>
          <p className="mt-1 text-sm">{prettyDateTime(libraryItem.modifiedAt)}</p>
          {progress ? (
            <p className="text-xs text-muted-foreground">
              {progress.completed ? 'Watched to the end' : `Last position ${formatRuntime(progress.positionSeconds / 60)}`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No playback history yet</p>
          )}
        </div>
      </div>

      {libraryItem.probe?.notes && libraryItem.probe.notes.length > 0 ? (
        <div className="surface mt-4 rounded-xl p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="mb-1.5 flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldCheck className="size-4 text-primary" aria-hidden />
            Probe notes
          </p>
          <ul className="space-y-1">
            {libraryItem.probe.notes.map((note) => (
              <li key={note}>· {note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
