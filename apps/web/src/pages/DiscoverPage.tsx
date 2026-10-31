/**
 * Discover — real search over real metadata, with the sample-catalogue case
 * labelled clearly rather than hidden.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Compass, Flame, Info, Loader2, Search, Sparkles, X } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/app/AppShell';
import { FeaturedHero } from '@/components/media/FeaturedHero';
import { PosterGrid } from '@/components/media/PosterGrid';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHealth, useSearch, useTrending } from '@/api/hooks';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { errorMessage } from '@/api/hooks';
import { useUiStore } from '@/store/ui';
import { cn } from '@/lib/utils';

export function DiscoverPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get('q') ?? '';
  const [term, setTerm] = useState(initial);
  const [kind, setKind] = useState<'multi' | 'movie' | 'tv'>('multi');
  const [page, setPage] = useState(1);
  const debounced = useDebouncedValue(term, 350);
  const rememberSearch = useUiStore((state) => state.rememberSearch);

  const health = useHealth();
  const trending = useTrending();
  const search = useSearch(debounced, kind, page, debounced.trim().length > 1);

  useEffect(() => {
    setPage(1);
  }, [debounced, kind]);

  useEffect(() => {
    if (debounced.trim().length > 1) rememberSearch(debounced);
  }, [debounced, rememberSearch]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (debounced.trim().length > 1) next.set('q', debounced);
    else next.delete('q');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const searching = debounced.trim().length > 1;
  const results = useMemo(() => search.data?.results ?? [], [search.data]);
  const totalPages = search.data?.totalPages ?? 1;

  const featured = (searching ? results[0] : trending.data?.results[0]) ?? undefined;
  const mock = searching ? search.data?.mock : trending.data?.mock;

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Discover"
        badge={<StatusBadge state={health.data ? (health.data.mode === 'live' ? 'live' : 'fixture') : 'unknown'} />}
        description="Search real catalogue metadata for films and series. Metadata tells you what a title is — it is never a download link, so availability and downloadability are checked separately on each title page."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/downloads">
                <Flame className="size-3.5" aria-hidden />
                Queue
              </Link>
            </Button>
          </div>
        }
      />

      {/* ------------------------------- search bar ------------------------------ */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search films and series by title…"
              className="h-11 pl-9 pr-9 text-[15px]"
              aria-label="Search titles"
              autoComplete="off"
              spellCheck={false}
            />
            {term ? (
              <button
                type="button"
                onClick={() => setTerm('')}
                aria-label="Clear the search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter by media type">
            {(['multi', 'movie', 'tv'] as const).map((option) => (
              <Button
                key={option}
                variant={kind === option ? 'default' : 'outline'}
                size="sm"
                onClick={() => setKind(option)}
                aria-pressed={kind === option}
                className="flex-1 sm:flex-none"
              >
                {option === 'multi' ? 'Everything' : option === 'movie' ? 'Films' : 'Series'}
              </Button>
            ))}
          </div>
        </div>

        {mock ? (
          <Alert variant="warning">
            <Info />
            <AlertTitle>Sample catalogue — no TMDB key configured</AlertTitle>
            <AlertDescription>
              These titles come from a small offline fixture bundled with BlaxkVault so the app is usable without credentials. Add
              <span className="px-1 font-mono text-xs">TMDB_API_KEY</span> to <span className="font-mono text-xs">.env</span> for live metadata.
              Nothing here is a download link.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {/* --------------------------------- hero --------------------------------- */}
      {featured && !searching ? <FeaturedHero item={featured} /> : null}

      {/* ------------------------------- results -------------------------------- */}
      {searching ? (
        <section aria-labelledby="results-heading" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="results-heading" className="text-sm font-semibold">
              {search.isLoading ? 'Searching…' : `${search.data?.totalResults ?? 0} result${search.data?.totalResults === 1 ? '' : 's'}`}
              {search.data?.query ? <span className="font-normal text-muted-foreground"> for “{search.data.query}”</span> : null}
            </h2>
            {search.isFetching ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Searching" /> : null}
            {search.data ? (
              <Badge variant="neutral" className="ml-auto">
                {search.data.tookMs} ms · page {search.data.page} of {search.data.totalPages}
              </Badge>
            ) : null}
          </div>

          <PosterGrid
            items={results}
            loading={search.isLoading}
            error={search.isError ? errorMessage(search.error) : null}
            onRetry={() => search.refetch()}
            emptyTitle={`No titles matched “${debounced}”`}
            emptyDescription="Only real catalogue entries are shown. Try a different spelling, or search for a director's name."
          />

          {totalPages > 1 ? (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || search.isFetching} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || search.isFetching}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          ) : null}
        </section>
      ) : (
        <section aria-labelledby="browse-heading" className="space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" aria-hidden />
            <h2 id="browse-heading" className="text-sm font-semibold">
              {trending.data?.mock ? 'Sample catalogue picks' : 'Trending this week'}
            </h2>
            <Button variant="ghost" size="sm" className="ml-auto" asChild>
              <Link to="/library">
                <Compass className="size-3.5" aria-hidden />
                Your offline library
              </Link>
            </Button>
          </div>

          <PosterGrid
            items={(trending.data?.results ?? []).slice(1)}
            loading={trending.isLoading}
            error={trending.isError ? errorMessage(trending.error) : null}
            onRetry={() => trending.refetch()}
            emptyTitle="Nothing to browse yet"
            emptyDescription="Start typing above to search the catalogue."
          />

          <p className={cn('pt-2 text-xs text-muted-foreground')}>{trending.data?.attribution}</p>
        </section>
      )}
    </div>
  );
}
