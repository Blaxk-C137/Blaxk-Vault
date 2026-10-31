/**
 * VaultPlayer — the one place that knows about the player library.
 *
 * Library decision (documented in docs/UI_RESEARCH.md): Vidstack (@vidstack/react
 * 1.15.x, MIT) is used because its API is stable and verified, BUT it is now
 * formally deprecated in favour of Video.js 10 (`@videojs/react`, Apache-2.0) —
 * we found that live on npm and on vidstack.io. Rather than pretend otherwise,
 * the player is isolated behind this component so migrating is a one-file change.
 *
 * Real behaviour only:
 *   - plays through the browser's native media stack (mp4/webm/m4a/mp3…),
 *   - exposes subtitle sidecars that actually exist on disk,
 *   - resumes from the position the server remembered,
 *   - reports unsupported codecs instead of showing a silent black rectangle.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MediaPlayer,
  MediaProvider,
  type AudioMimeType,
  type MediaPlayerInstance,
  type PlayerSrc,
  type VideoMimeType,
} from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';
import type { LibraryItem } from '@blaxkvault/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ExternalLink, Info } from 'lucide-react';
import '@vidstack/react/player/styles/default/theme.css';
import '@vidstack/react/player/styles/default/layouts/video.css';

/**
 * Only the container types the player library can declare are listed. Anything
 * else (mkv, mov, ts, wav) is handed over as a bare URL: the browser decides,
 * and if it refuses we say so with the real probe data instead of pretending.
 */
const PLAYER_MIME: Record<string, VideoMimeType | AudioMimeType> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  avi: 'video/avi',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  ts: 'video/mpeg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp3',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
};

export function VaultPlayer({
  item,
  streamUrl,
  startAtSeconds,
  onSaveProgress,
}: {
  item: LibraryItem;
  streamUrl: string;
  startAtSeconds: number;
  onSaveProgress: (input: { positionSeconds: number; durationSeconds?: number; completed?: boolean }) => void;
}) {
  const player = useRef<MediaPlayerInstance>(null);
  const lastSaved = useRef(0);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const save = useCallback(
    (positionSeconds: number, durationSeconds?: number, completed?: boolean) => {
      if (!Number.isFinite(positionSeconds)) return;
      onSaveProgress({ positionSeconds: Math.max(0, positionSeconds), durationSeconds, completed });
      lastSaved.current = Date.now();
    },
    [onSaveProgress],
  );

  // Throttled position writes: at most one per 10s while playing (§10).
  const handleTimeUpdate = useCallback(
    (detail: { currentTime: number }) => {
      if (Date.now() - lastSaved.current > 10_000) save(detail.currentTime, player.current?.duration ?? undefined);
    },
    [save],
  );

  // Flush the final position when the viewer leaves the page.
  useEffect(() => {
    const instance = player.current;
    return () => {
      const time = instance?.currentTime;
      if (typeof time === 'number' && time > 0) save(time, instance?.duration ?? undefined);
    };
  }, [save]);

  const tracks = item.subtitleTracks.map((track, index) => ({
    src: track.url,
    kind: 'subtitles' as const,
    label: track.label,
    language: track.language === 'und' ? 'en' : track.language,
    default: index === 0,
  }));

  return (
    <div className="space-y-3">
      {playbackError ? (
        <Alert variant="destructive">
          <Info />
          <AlertTitle>The browser refused to play this file</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>{playbackError}</p>
            <p>
              The file itself is fine — it is stored in your library. Open it in an external player (VLC, mpv, Infuse) or install ffmpeg and
              transcode it if you want in-browser playback.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <MediaPlayer
        ref={player}
        title={item.title}
        src={(PLAYER_MIME[item.extension] ? { src: streamUrl, type: PLAYER_MIME[item.extension]! } : streamUrl) as PlayerSrc}
        currentTime={startAtSeconds > 5 ? startAtSeconds : 0}
        playsInline
        volume={1}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          const instance = player.current;
          save(instance?.duration ?? 0, instance?.duration ?? undefined, true);
        }}
        onError={() =>
          setPlaybackError(
            item.probe && !item.probe.browserPlayable
              ? `This is a ${item.probe.container ?? item.extension} file${item.probe.videoCodec ? ` (${item.probe.videoCodec} video)` : ''}, which browsers cannot decode.`
              : 'The browser reported a media error while decoding this file.',
          )
        }
        className="overflow-hidden rounded-xl border border-border/70 bg-black"
      >
        <MediaProvider />
        {/* The full default layout: keyboard shortcuts, captions menu, PiP,
            fullscreen and volume are all real controls, no custom re-invention. */}
        <DefaultVideoLayout icons={defaultLayoutIcons} />
      </MediaPlayer>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          Playing from <span className="font-mono">{item.relativePath}</span>
        </span>
        <a className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground" href={streamUrl} download={item.fileName}>
          <ExternalLink className="size-3" aria-hidden />
          Open in an external player
        </a>
        {item.subtitleTracks.length > 0 ? <span>{item.subtitleTracks.length} subtitle track(s) available in the captions menu</span> : null}
      </div>
    </div>
  );
}
