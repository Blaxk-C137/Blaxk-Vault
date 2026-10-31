/**
 * Offline library.
 *
 * Indexes only folders the operator approved, states clearly when a file has
 * gone missing, and explains codecs the browser cannot play instead of hiding
 * them behind a broken player.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, FolderOpen, HardDrive, Loader2, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@/components/app/AppShell';
import { LibraryList } from '@/components/library/LibraryList';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useLibrary, useScanLibrary, useStats } from '@/api/hooks';
import { errorMessage } from '@/api/hooks';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { formatBytes } from '@/lib/format';

export function LibraryPage() {
  const [term, setTerm] = useState('');
  const [kind, setKind] = useState<'all' | 'movie' | 'tv' | 'other'>('all');
  const [sort, setSort] = useState<'recent' | 'title' | 'size'>('recent');
  const [missingOnly, setMissingOnly] = useState(false);
  const debounced = useDebouncedValue(term, 250);

  const library = useLibrary({ q: debounced || undefined, kind, sort });
  const stats = useStats();
  const scan = useScanLibrary();

  const items = useMemo(() => {
    const all = library.data?.items ?? [];
    return missingOnly ? all.filter((item) => item.missing) : all;
  }, [library.data, missingOnly]);

  const missingCount = library.data?.stats.missing ?? 0;

  return (
    <div className="mx-auto max-w-[1200px]">
      <PageHeader
        title="Offline library"
        description="Files BlaxkVault has indexed in your approved media roots. Sizes, codecs and durations are probed from the real files; missing files are flagged rather than quietly dropped."
        badge={
          <Badge variant="neutral" className="gap-1">
            <HardDrive className="size-3" aria-hidden />
            {library.data?.stats.items ?? 0} files · {formatBytes(library.data?.stats.bytes ?? 0)}
          </Badge>
        }
        actions={
          <Button size="sm" onClick={() => scan.mutate()} disabled={scan.isPending}>
            {scan.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCw className="size-3.5" aria-hidden />}
            Rescan library
          </Button>
        }
      />

      {missingCount > 0 ? (
        <Alert variant="warning" className="mb-4">
          <AlertTriangle />
          <AlertTitle>{missingCount} indexed file{missingCount === 1 ? ' is' : 's are'} missing from disk</AlertTitle>
          <AlertDescription>
            The index still lists them so you can see what disappeared. Playback is disabled for those entries until the file returns.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* --------------------------------- controls -------------------------------- */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Filter by title, filename or path…"
            className="pl-9"
            aria-label="Filter library"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
            <SelectTrigger className="w-[140px]" aria-label="Filter by kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              <SelectItem value="movie">Films</SelectItem>
              <SelectItem value="tv">Series episodes</SelectItem>
              <SelectItem value="other">Unclassified</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}>
            <SelectTrigger className="w-[150px]" aria-label="Sort library">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Newest first</SelectItem>
              <SelectItem value="title">Title A–Z</SelectItem>
              <SelectItem value="size">Largest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="missing-only" checked={missingOnly} onCheckedChange={setMissingOnly} />
          <Label htmlFor="missing-only" className="text-sm text-muted-foreground">
            Missing only
          </Label>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div>
          {library.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ) : library.isError ? (
            <EmptyState
              tone="error"
              icon={AlertTriangle}
              title="The library index could not be read"
              description={errorMessage(library.error)}
              action={
                <Button size="sm" variant="outline" onClick={() => library.refetch()}>
                  Try again
                </Button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={term || kind !== 'all' || missingOnly ? 'No files match those filters' : 'Your library is empty'}
              description={
                term || kind !== 'all' || missingOnly
                  ? 'Clear the filters to see everything BlaxkVault has indexed.'
                  : 'Downloaded files appear here automatically. You can also add folders you already own in Settings → Media roots, then rescan.'
              }
              action={
                <Button size="sm" variant="outline" onClick={() => scan.mutate()} disabled={scan.isPending}>
                  <RefreshCw className="size-3.5" aria-hidden />
                  Rescan now
                </Button>
              }
            />
          ) : (
            <LibraryList items={items} />
          )}
        </div>

        {/* ------------------------------- diagnostics ------------------------------ */}
        <aside className="space-y-4">
          <div className="surface rounded-xl p-4 text-sm">
            <p className="mb-2 flex items-center gap-2 font-medium">
              <HardDrive className="size-4 text-primary" aria-hidden />
              Storage
            </p>
            <dl className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Indexed size</dt>
                <dd className="tabular-nums">{formatBytes(library.data?.stats.bytes ?? 0)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Free space</dt>
                <dd className="tabular-nums">{formatBytes(stats.data?.disk.freeBytes ?? 0)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">Total capacity</dt>
                <dd className="tabular-nums">{formatBytes(stats.data?.disk.totalBytes ?? 0)}</dd>
              </div>
            </dl>

            <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
              <p className="text-xs font-medium text-muted-foreground">Approved media roots</p>
              {(library.data?.roots ?? []).map((root) => (
                <div key={root.root} className="flex items-start gap-2 text-xs">
                  <Badge variant={root.exists && root.writable ? 'success' : root.exists ? 'warning' : 'danger'}>
                    {root.exists ? (root.writable ? 'read/write' : 'read-only') : 'missing'}
                  </Badge>
                  <span className="min-w-0 truncate font-mono text-[11px]" title={root.root}>
                    {root.root}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="surface rounded-xl p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-2 text-sm font-medium text-foreground">Folder layout</p>
            <pre className="overflow-x-auto rounded-md bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
{`BlaxkVault-Media/
├─ Movies/
│  └─ Film Name (Year)/
│     └─ Film Name (Year).mkv
└─ Series/
   └─ Series Name/
      └─ Season 01/
         └─ Series Name - S01E01.mp4`}
            </pre>
            <p className="mt-2">Hand-curated folders are supported too — BlaxkVault reads season/episode codes from filenames when it can.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
