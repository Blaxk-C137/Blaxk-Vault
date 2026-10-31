/**
 * Sources & licences.
 *
 * Every adapter BlaxkVault ships is listed with what it can and cannot do, its
 * documentation URL, its attribution requirements, and whether it is configured.
 * This is the screen that makes the product's claims checkable.
 */
import { useState } from 'react';
import {
  BadgeCheck,
  ExternalLink,
  Info,
  Loader2,
  Plug,
  Search,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/app/AppShell';
import { VerdictChip } from '@/components/media/DownloadabilityPanel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useArchiveSearch, useInspect, useSources } from '@/api/hooks';
import { errorMessage } from '@/api/hooks';
import { formatBytes } from '@/lib/format';

const CAPABILITY_LABEL: Record<string, string> = {
  metadata: 'Metadata',
  availability: 'Where to watch',
  'authorized-download': 'Authorised download',
  'local-library': 'Local library',
};

export function SourcesPage() {
  const sources = useSources();
  const inspect = useInspect();
  const [url, setUrl] = useState('');
  const [archiveTerm, setArchiveTerm] = useState('');
  const [archiveQuery, setArchiveQuery] = useState('');
  const archive = useArchiveSearch(archiveQuery, 1, archiveQuery.length > 2);

  const inspection = inspect.data?.inspection;

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Sources & licences"
        description="Where BlaxkVault's data comes from, what each source is allowed to do, and which credentials are configured. Secrets stay on the server — this screen only reports whether a key exists."
        badge={
          <Badge variant="neutral" className="gap-1">
            <Plug className="size-3" aria-hidden />
            {sources.data?.sources.length ?? 0} adapters
          </Badge>
        }
      />

      <Alert variant="info" className="mb-5">
        <ShieldAlert />
        <AlertTitle>What BlaxkVault will not do</AlertTitle>
        <AlertDescription>
          No DRM circumvention, no paywall bypass, no scraping a streaming provider, no treating a metadata record as a file. Downloads are limited to
          sources whose own rights fields permit it, plus direct links you supply and vouch for.
        </AlertDescription>
      </Alert>

      {/* -------------------------------- adapters -------------------------------- */}
      {sources.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      ) : sources.isError ? (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Could not load the source registry</AlertTitle>
          <AlertDescription>{errorMessage(sources.error)}</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sources.data?.sources.map((source) => (
            <Card key={source.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle>{source.label}</CardTitle>
                  <Badge variant={source.enabled ? 'success' : 'warning'}>{source.enabled ? 'Configured' : 'Not configured'}</Badge>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {source.capabilities.map((capability) => (
                    <Badge key={capability} variant="outline">
                      {CAPABILITY_LABEL[capability] ?? capability}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p className="leading-relaxed">{source.description}</p>

                {source.requiresKey ? (
                  <p className="flex items-start gap-2 text-xs">
                    <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                    Needs <span className="font-mono">{source.requiresKey}</span> in <span className="font-mono">.env</span>. The key is read
                    server-side only and never included in a response.
                  </p>
                ) : null}

                {source.attribution ? (
                  <p className="flex items-start gap-2 text-xs">
                    <BadgeCheck className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
                    Attribution: {source.attribution}
                  </p>
                ) : null}

                <Button variant="outline" size="sm" asChild>
                  <a href={source.docsUrl} target="_blank" rel="noreferrer noopener">
                    <ExternalLink className="size-3.5" aria-hidden />
                    Documentation & terms
                  </a>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ----------------------------- direct inspector ---------------------------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="size-4 text-primary" aria-hidden />
            Inspect a direct media link
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            This runs the full server-side check: SSRF guard, redirect-by-redirect validation, MIME type, real magic bytes, size, and range support.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (url.trim().length > 7) inspect.mutate({ url: url.trim() });
            }}
          >
            <Label htmlFor="sources-url" className="sr-only">
              Media URL
            </Label>
            <Input
              id="sources-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://archive.org/download/<identifier>/<file>.mp4"
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" disabled={inspect.isPending || url.trim().length < 8}>
              {inspect.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <BadgeCheck className="size-3.5" aria-hidden />}
              Inspect
            </Button>
          </form>

          {inspect.isError ? (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Refused</AlertTitle>
              <AlertDescription>{errorMessage(inspect.error)}</AlertDescription>
            </Alert>
          ) : null}

          {inspection ? (
            <div className="space-y-3 rounded-lg border border-border/70 bg-card/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <VerdictChip status={inspection.status} />
                <Badge variant="neutral">{inspect.data?.adapter.label}</Badge>
                {inspection.sizeBytes ? <Badge variant="outline">{formatBytes(inspection.sizeBytes)}</Badge> : null}
                {inspection.mimeType ? <Badge variant="outline">{inspection.mimeType}</Badge> : null}
              </div>
              {inspection.reason ? <p className="text-xs leading-relaxed text-status-paused">{inspection.reason}</p> : null}
              {inspection.rightsNote ? <p className="text-xs leading-relaxed text-muted-foreground">{inspection.rightsNote}</p> : null}
              {inspection.probe?.notes?.length ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {inspection.probe.notes.map((note) => (
                    <li key={note}>· {note}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[11px] text-muted-foreground">Inspected {new Date(inspection.inspectedAt).toLocaleString()}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------------------- archive browsing ----------------------------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="size-4 text-primary" aria-hidden />
            Browse the Internet Archive
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Real search across archive.org's movie collection. Each hit shows whether the item itself states an open licence or public-domain status —
            items without a rights statement can never be queued.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              setArchiveQuery(archiveTerm.trim());
            }}
          >
            <Label htmlFor="archive-term" className="sr-only">
              Search the Internet Archive
            </Label>
            <Input
              id="archive-term"
              value={archiveTerm}
              onChange={(event) => setArchiveTerm(event.target.value)}
              placeholder="e.g. Night of the Living Dead"
            />
            <Button type="submit" variant="secondary" disabled={archiveTerm.trim().length < 3}>
              Search archive.org
            </Button>
          </form>

          {archive.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          ) : archive.isError ? (
            <Alert variant="warning">
              <TriangleAlert />
              <AlertTitle>Archive search failed</AlertTitle>
              <AlertDescription>{errorMessage(archive.error)}</AlertDescription>
            </Alert>
          ) : archive.data && archive.data.results.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
              archive.org returned no items for “{archiveQuery}”.
            </p>
          ) : archive.data ? (
            <ul className="space-y-2">
              {archive.data.results.map((item) => (
                <li key={item.identifier} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-card/40 p-2.5">
                  <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md bg-secondary/50">
                    <img src={item.thumbnailUrl} alt="" aria-hidden className="size-full object-cover" loading="lazy" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.creator ? `${item.creator} · ` : ''}
                      {item.year ?? 'year unknown'}
                      {item.downloadCount ? ` · ${item.downloadCount.toLocaleString()} downloads` : ''}
                    </p>
                  </div>
                  <Badge variant={item.rightsPermitted ? 'success' : 'warning'}>
                    {item.rightsPermitted ? 'Open licence / public domain' : 'Rights not stated'}
                  </Badge>
                  <Button size="sm" variant="outline" asChild>
                    <a href={item.itemUrl} target="_blank" rel="noreferrer noopener">
                      <ExternalLink className="size-3.5" aria-hidden />
                      Item page
                    </a>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}

          {archive.data ? <p className="text-xs text-muted-foreground">{archive.data.note}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}
