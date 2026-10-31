/**
 * ⌘K command palette (shadcn/ui Command → cmdk, MIT).
 *
 * Two jobs in one surface:
 *   1. Search the metadata catalogue with a genuinely debounced query. Stale
 *      responses cannot land out of order because each query is a separate
 *      TanStack key and the input owns the source of truth.
 *   2. Run real navigation and app actions — never decorative entries.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clapperboard,
  Compass,
  DownloadCloud,
  Film,
  HardDriveDownload,
  Library,
  Loader2,
  Plug,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Tv,
} from 'lucide-react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { useScanLibrary, useSearch, useTrending } from '@/api/hooks';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useUiStore } from '@/store/ui';
import { cn } from '@/lib/utils';

export function CommandPalette() {
  const navigate = useNavigate();
  const open = useUiStore((state) => state.commandOpen);
  const setOpen = useUiStore((state) => state.setCommandOpen);
  const recentSearches = useUiStore((state) => state.recentSearches);
  const rememberSearch = useUiStore((state) => state.rememberSearch);
  const clearRecentSearches = useUiStore((state) => state.clearRecentSearches);
  const setTheme = useUiStore((state) => state.setTheme);
  const theme = useUiStore((state) => state.theme);

  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'multi' | 'movie' | 'tv'>('multi');
  const debounced = useDebouncedValue(query, 320);

  const search = useSearch(debounced, kind, 1, debounced.trim().length > 1);
  const trending = useTrending({ enabled: open && debounced.trim().length <= 1 });
  const scan = useScanLibrary();

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const results = useMemo(() => search.data?.results ?? [], [search.data]);
  const suggestions = useMemo(() => (trending.data?.results ?? []).slice(0, 6), [trending.data]);

  const run = (action: () => void) => {
    setOpen(false);
    // Defer so the dialog's exit animation is not fighting the route change.
    setTimeout(action, 60);
  };

  const openTitle = (id: string) => {
    rememberSearch(query);
    run(() => navigate(`/title/${encodeURIComponent(id)}`));
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search films and series, or type a command…"
        aria-label="Search or run a command"
      />

      <div className="flex items-center gap-1.5 border-b border-border/70 px-3 py-1.5" role="group" aria-label="Filter by media type">
        {(['multi', 'movie', 'tv'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setKind(option)}
            aria-pressed={kind === option}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
              kind === option ? 'border-primary/50 bg-primary/12 text-primary' : 'border-border text-muted-foreground hover:text-foreground',
            )}
          >
            {option === 'multi' ? 'Everything' : option === 'movie' ? 'Films' : 'Series'}
          </button>
        ))}
        {search.isFetching ? <Loader2 className="ml-auto size-3.5 animate-spin text-muted-foreground" aria-label="Searching" /> : null}
      </div>

      <CommandList>
        {debounced.trim().length > 1 && !search.isFetching && results.length === 0 ? (
          <CommandEmpty>
            No titles matched “{debounced}”.
            <span className="mt-1 block text-xs">BlaxkVault searches real catalogue metadata — it never invents titles.</span>
          </CommandEmpty>
        ) : null}

        {results.length > 0 ? (
          <CommandGroup heading={`Results for “${debounced}”`}>
            {results.map((item) => (
              <CommandItem key={item.id} value={`${item.title} ${item.year ?? ''} ${item.id}`} onSelect={() => openTitle(item.id)}>
                {item.kind === 'movie' ? <Film aria-hidden /> : <Tv aria-hidden />}
                <span className="truncate">{item.title}</span>
                {item.year ? <span className="text-xs text-muted-foreground">{item.year}</span> : null}
                <Badge variant="neutral" className="ml-auto">
                  {item.kind === 'movie' ? 'Film' : 'Series'}
                </Badge>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {query.trim().length <= 1 && suggestions.length > 0 ? (
          <CommandGroup heading={trending.data?.mock ? 'Sample catalogue (no TMDB key)' : 'Trending this week'}>
            {suggestions.map((item) => (
              <CommandItem key={item.id} value={item.id} onSelect={() => openTitle(item.id)}>
                {item.kind === 'movie' ? <Film aria-hidden /> : <Tv aria-hidden />}
                <span className="truncate">{item.title}</span>
                {item.year ? <span className="text-xs text-muted-foreground">{item.year}</span> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {query.trim().length <= 1 && recentSearches.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Recent searches">
              {recentSearches.map((term) => (
                <CommandItem key={term} value={`recent-${term}`} onSelect={() => setQuery(term)}>
                  <Search aria-hidden />
                  <span className="truncate">{term}</span>
                </CommandItem>
              ))}
              <CommandItem value="clear-recent" onSelect={clearRecentSearches}>
                <Sparkles aria-hidden />
                Clear recent searches
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />
        <CommandGroup heading="Go to">
          <CommandItem value="nav-discover" onSelect={() => run(() => navigate('/'))}>
            <Compass aria-hidden />
            Discover
          </CommandItem>
          <CommandItem value="nav-downloads" onSelect={() => run(() => navigate('/downloads'))}>
            <DownloadCloud aria-hidden />
            Downloads
          </CommandItem>
          <CommandItem value="nav-library" onSelect={() => run(() => navigate('/library'))}>
            <Library aria-hidden />
            Offline library
          </CommandItem>
          <CommandItem value="nav-sources" onSelect={() => run(() => navigate('/sources'))}>
            <Plug aria-hidden />
            Sources &amp; licences
          </CommandItem>
          <CommandItem value="nav-settings" onSelect={() => run(() => navigate('/settings'))}>
            <Settings aria-hidden />
            Settings
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="action-scan" onSelect={() => run(() => scan.mutate())}>
            <RefreshCw className={cn(scan.isPending && 'animate-spin')} aria-hidden />
            Rescan the offline library
            <CommandShortcut>writes nothing</CommandShortcut>
          </CommandItem>
          <CommandItem value="action-theme" onSelect={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Sun aria-hidden />
            Switch to the {theme === 'dark' ? 'light' : 'dark'} theme
          </CommandItem>
          <CommandItem value="action-inspect" onSelect={() => run(() => navigate('/sources'))}>
            <HardDriveDownload aria-hidden />
            Inspect a direct download link
          </CommandItem>
          <CommandItem value="action-about" onSelect={() => run(() => navigate('/title/tmdb:movie:900001'))}>
            <Clapperboard aria-hidden />
            Open a sample title from the fixture catalogue
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
