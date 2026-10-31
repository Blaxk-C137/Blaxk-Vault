/**
 * Title detail — films and series.
 *
 * Three questions are answered on three separate surfaces, never conflated:
 *   - What is this?                  → Overview tab (catalogue metadata)
 *   - Where can I watch it legally?  → Where to watch tab (provider listings)
 *   - Is there a file I may keep?    → Downloads tab (rights-verified verdicts)
 */
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Clock,
  DownloadCloud,
  ExternalLink,
  Film,
  Info,
  ListVideo,
  Play,
  Star,
  Tv,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/app/AppShell';
import { AvailabilityList } from '@/components/media/AvailabilityList';
import { DownloadabilityPanel, VerdictChip } from '@/components/media/DownloadabilityPanel';
import { EpisodePicker } from '@/components/media/EpisodePicker';
import { PosterArt } from '@/components/media/PosterArt';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAvailability, useLocalCopies, useTitle } from '@/api/hooks';
import { errorMessage } from '@/api/hooks';
import { formatRuntime, prettyDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export function TitlePage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const title = useTitle(id);
  const availability = useAvailability(id);
  /**
   * The active tab and the "run the downloadability check" flag are one piece of
   * state, because two separate flags is how the check silently ran behind the
   * Overview tab — the button looked dead.
   */
  const [tab, setTab] = useState<'overview' | 'watch' | 'downloads' | 'episodes'>(
    location.hash === '#downloads' ? 'downloads' : location.hash === '#where-to-watch' ? 'watch' : 'overview',
  );
  const [downloadRequested, setDownloadRequested] = useState(location.hash === '#downloads');

  const openDownloads = () => {
    setTab('downloads');
    setDownloadRequested(true);
  };

  const data = title.data;
  const kind = data?.kind ?? 'movie';

  // Matched on the server against the library index: same distinctive words, and
  // the same year when both sides state one. A wrong "you already own this" would
  // open the wrong film, so the rule is strict rather than fuzzy.
  const local = useLocalCopies(id, Boolean(data));
  const localCopies = local.data?.copies ?? [];

  if (title.isLoading) {
    return (
      <div className="mx-auto max-w-[1200px] space-y-6">
        <Skeleton className="h-[280px] w-full rounded-2xl" />
        <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
          <Skeleton className="aspect-2/3 w-full rounded-xl" />
          <div className="space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      </div>
    );
  }

  if (title.isError || !data) {
    const message = title.isError ? errorMessage(title.error) : 'That title could not be loaded.';
    const missing = /not in the offline sample catalogue|not found/i.test(message);
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant={missing ? 'warning' : 'destructive'}>
          <AlertTriangle />
          <AlertTitle>{missing ? 'Not in the sample catalogue' : 'Could not load this title'}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{message}</p>
            <Button size="sm" variant="outline" asChild>
              <Link to="/">
                <ArrowLeft className="size-3.5" aria-hidden />
                Back to Discover
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const tmdbId = data.tmdbId;

  return (
    <div className="mx-auto max-w-[1200px]">
      {/* ------------------------------ cinematic hero ---------------------------- */}
      <section className="relative mb-6 overflow-hidden rounded-2xl border border-border/70" aria-labelledby="title-heading">
        <div className="absolute inset-0">
          {data.backdropUrl ? (
            <img src={data.backdropUrl} alt="" aria-hidden className="size-full object-cover opacity-60" loading="eager" />
          ) : (
            <div className="size-full bg-[radial-gradient(120%_120%_at_20%_0%,oklch(0.33_0.09_292)_0%,oklch(0.18_0.02_285)_50%,oklch(0.145_0.008_285)_100%)]" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/85 to-background/35" />
        </div>

        <div className="relative grid gap-5 p-5 sm:grid-cols-[160px_1fr] sm:p-7 lg:grid-cols-[200px_1fr] lg:p-9">
          <div className="w-32 sm:w-full">
            <PosterArt src={data.posterUrl} alt={`${data.title} poster`} title={data.title} kind={data.kind} eager />
          </div>

          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button variant="ghost" size="sm" className="-ml-2 h-7" asChild>
                <Link to="/">
                  <ArrowLeft className="size-3.5" aria-hidden />
                  Discover
                </Link>
              </Button>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1">
                {kind === 'tv' ? <Tv className="size-3" aria-hidden /> : <Film className="size-3" aria-hidden />}
                {kind === 'tv' ? 'Series' : 'Film'}
              </span>
            </div>

            <h1 id="title-heading" className="display-tight text-2xl leading-tight sm:text-3xl lg:text-4xl">
              {data.title}
            </h1>
            {data.originalTitle && data.originalTitle !== data.title ? (
              <p className="text-sm text-muted-foreground">{data.originalTitle}</p>
            ) : null}
            {data.tagline ? <p className="text-sm italic text-muted-foreground">“{data.tagline}”</p> : null}

            <div className="flex flex-wrap items-center gap-2">
              {data.year ? (
                <Badge variant="neutral" className="gap-1">
                  <Calendar className="size-3" aria-hidden />
                  {data.year}
                </Badge>
              ) : null}
              {data.runtimeMinutes ? (
                <Badge variant="neutral" className="gap-1">
                  <Clock className="size-3" aria-hidden />
                  {formatRuntime(data.runtimeMinutes)}
                </Badge>
              ) : null}
              {data.voteAverage ? (
                <Badge variant="outline" className="gap-1">
                  <Star className="size-3 fill-current" aria-hidden />
                  {data.voteAverage.toFixed(1)}
                  {data.voteCount ? <span className="text-muted-foreground">({data.voteCount.toLocaleString()})</span> : null}
                </Badge>
              ) : null}
              {data.genres.map((genre) => (
                <Badge key={genre.id} variant="outline">
                  {genre.name}
                </Badge>
              ))}
              {data.status ? <Badge variant="neutral">{data.status}</Badge> : null}
            </div>

            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground text-balance">
              {data.overview?.trim() || 'The catalogue has no synopsis for this title yet.'}
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {localCopies.length > 0 ? (
                <Button asChild>
                  <Link to={`/watch/${localCopies[0]!.id}`}>
                    <Play className="size-4" aria-hidden />
                    Play your copy
                  </Link>
                </Button>
              ) : null}
              <Button variant={localCopies.length > 0 ? 'outline' : 'default'} onClick={openDownloads}>
                <DownloadCloud className="size-4" aria-hidden />
                Check downloadability
              </Button>
              <Button variant="outline" onClick={() => setTab('watch')}>
                <Info className="size-4" aria-hidden />
                Where to watch
              </Button>
              {localCopies.length > 0 ? (
                <Badge variant="success" className="gap-1">
                  {localCopies.length} copy{localCopies.length === 1 ? '' : 'ies'} offline
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------- tabs --------------------------------- */}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          // Opening the Downloads tab *is* the request to check, so the panel is
          // never an empty box behind a button.
          setTab(value as typeof tab);
          if (value === 'downloads') setDownloadRequested(true);
        }}
      >
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">
            <Info className="size-3.5" aria-hidden />
            Overview
          </TabsTrigger>
          <TabsTrigger value="watch" id="where-to-watch">
            <Play className="size-3.5" aria-hidden />
            Where to watch
          </TabsTrigger>
          <TabsTrigger value="downloads" id="downloads">
            <DownloadCloud className="size-3.5" aria-hidden />
            Downloads
          </TabsTrigger>
          {kind === 'tv' ? (
            <TabsTrigger value="episodes">
              <ListVideo className="size-3.5" aria-hidden />
              Episodes
            </TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>About this {kind === 'tv' ? 'series' : 'film'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                <p>{data.overview?.trim() || 'No synopsis available.'}</p>
                <dl className="grid grid-cols-2 gap-3 pt-2 text-xs sm:grid-cols-3">
                  {data.releaseDate ? (
                    <div>
                      <dt className="text-muted-foreground/80">Released</dt>
                      <dd className="text-foreground">{prettyDate(data.releaseDate)}</dd>
                    </div>
                  ) : null}
                  {data.imdbId ? (
                    <div>
                      <dt className="text-muted-foreground/80">IMDb</dt>
                      <dd>
                        <a
                          className="text-foreground underline underline-offset-2"
                          href={`https://www.imdb.com/title/${data.imdbId}/`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {data.imdbId}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  {data.homepage ? (
                    <div>
                      <dt className="text-muted-foreground/80">Official site</dt>
                      <dd>
                        <a className="text-foreground underline underline-offset-2" href={data.homepage} target="_blank" rel="noreferrer noopener">
                          Visit
                        </a>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-4 text-primary" aria-hidden />
                  Cast
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.cast.length === 0 ? (
                  <p className="text-sm text-muted-foreground">The catalogue lists no cast for this title.</p>
                ) : (
                  data.cast.slice(0, 10).map((member) => (
                    <div key={`${member.id}-${member.order}`} className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary/60 text-xs">
                        {member.profileUrl ? (
                          <img src={member.profileUrl} alt="" aria-hidden className="size-full object-cover" loading="lazy" />
                        ) : (
                          member.name.slice(0, 1)
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm">{member.name}</p>
                        {member.character ? <p className="truncate text-xs text-muted-foreground">{member.character}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {data.crew.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Crew</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {data.crew.map((member) => (
                  <div key={`${member.id}-${member.job}`} className="min-w-40">
                    <p className="text-foreground">{member.name}</p>
                    <p className="text-xs text-muted-foreground">{member.job}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <p className="text-xs text-muted-foreground">{data.attribution}</p>
        </TabsContent>

        <TabsContent value="watch" className="space-y-4">
          <Alert variant="info">
            <Info />
            <AlertTitle>Listings are viewing options, not files</AlertTitle>
            <AlertDescription>
              BlaxkVault never turns a provider listing into a download. Each entry opens the provider's own page in a new tab.
            </AlertDescription>
          </Alert>
          <AvailabilityList
            data={availability.data}
            loading={availability.isLoading}
            errorUserMessage={availability.isError ? errorMessage(availability.error) : null}
          />
        </TabsContent>

        <TabsContent value="downloads" className="space-y-4">
          <DownloadabilityPanel
            titleId={data.id}
            title={data.title}
            year={data.year}
            kind={kind}
            tmdbId={tmdbId}
            autoCheck={downloadRequested}
            ownedCount={localCopies.length}
          />
          {localCopies.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DownloadCloud className="size-4 text-status-completed" aria-hidden />
                  Already in your library
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {localCopies.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{item.fileName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.relativePath} · {(item.sizeBytes / 1024 ** 2).toFixed(1)} MB
                      </p>
                    </div>
                    {!item.missing ? (
                      <Button size="sm" asChild>
                        <Link to={`/watch/${item.id}`}>
                          <Play className="size-3.5" aria-hidden />
                          Play
                        </Link>
                      </Button>
                    ) : (
                      <Badge variant="danger">Missing from disk</Badge>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </TabsContent>

        {kind === 'tv' ? (
          <TabsContent value="episodes" className="space-y-4">
            {data.seasons && data.seasons.length > 0 ? (
              <EpisodePicker titleId={data.id} seriesTitle={data.title} kind={kind} tmdbId={tmdbId} seasons={data.seasons} />
            ) : (
              <Alert variant="warning">
                <Info />
                <AlertTitle>No season data</AlertTitle>
                <AlertDescription>The catalogue returned no seasons for this series, so there are no episodes to list.</AlertDescription>
              </Alert>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
