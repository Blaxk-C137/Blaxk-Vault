/**
 * Settings.
 *
 * Everything here writes to the running server (PATCH /api/settings) and takes
 * effect without a restart. Credentials are never editable from the browser —
 * the page only reports whether the server has them.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FolderTree, HardDrive, Info, Loader2, Lock, Save, Sparkles, Wand2, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/app/AppShell';
import { QueueLimits } from '@/components/downloads/QueueLimits';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useHealth, useSettings, useUpdateSettings } from '@/api/hooks';
import { errorMessage } from '@/api/hooks';
import { formatBytes } from '@/lib/format';
import { useUiStore } from '@/store/ui';
import { prefersReducedMotion } from '@/lib/gsap';

export function SettingsPage() {
  const settings = useSettings();
  const health = useHealth();
  const update = useUpdateSettings();
  const theme = useUiStore((state) => state.theme);
  const motion = useUiStore((state) => state.motion);
  const setTheme = useUiStore((state) => state.setTheme);
  const setMotion = useUiStore((state) => state.setMotion);

  const [downloadDir, setDownloadDir] = useState('');
  const [rootsText, setRootsText] = useState('');
  const [tmdbRegion, setTmdbRegion] = useState('NG');
  const [watchmodeRegion, setWatchmodeRegion] = useState('NG');
  const [aria2Enabled, setAria2Enabled] = useState(false);
  const [aria2RpcUrl, setAria2RpcUrl] = useState('');

  useEffect(() => {
    const data = settings.data?.settings;
    if (!data) return;
    setDownloadDir(data.downloadDir);
    setRootsText(data.mediaRoots.join('\n'));
    setTmdbRegion(data.tmdbRegion);
    setWatchmodeRegion(data.watchmodeRegion);
    setAria2Enabled(data.aria2Enabled);
    setAria2RpcUrl(data.aria2RpcUrl);
  }, [settings.data]);

  if (settings.isLoading) {
    return (
      <div className="mx-auto max-w-[1000px] space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (settings.isError || !settings.data) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="destructive">
          <AlertTriangle />
          <AlertTitle>Settings could not be loaded</AlertTitle>
          <AlertDescription>{settings.isError ? errorMessage(settings.error) : 'No settings were returned.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const s = settings.data.settings;
  const storage = settings.data.storage;
  const reducedNow = prefersReducedMotion();

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        title="Settings"
        description="Server-side configuration that applies immediately. Credentials and secrets are environment-only, never editable here, and never sent to the browser."
        badge={<Badge variant="neutral">v{health.data?.version ?? '—'}</Badge>}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {/* ---------------------------- storage ---------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FolderTree className="size-4 text-primary" aria-hidden />
                Storage &amp; library paths
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="download-dir">Download directory</Label>
                <Input id="download-dir" value={downloadDir} onChange={(event) => setDownloadDir(event.target.value)} spellCheck={false} />
                <p className="text-xs text-muted-foreground">
                  Finished files are organised as <span className="font-mono">Movies/Title (Year)/…</span> and{' '}
                  <span className="font-mono">Series/Title/Season NN/…</span> inside this folder. It must sit inside an approved media root.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="media-roots">Approved media roots (one per line)</Label>
                <Textarea
                  id="media-roots"
                  value={rootsText}
                  onChange={(event) => setRootsText(event.target.value)}
                  rows={4}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  BlaxkVault only ever reads and writes inside these folders. Paths outside them are refused, and symlinks that escape a root are skipped.
                </p>
              </div>

              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    downloadDir,
                    mediaRoots: rootsText
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean),
                  })
                }
              >
                {update.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                Save storage settings
              </Button>

              <div className="space-y-2 border-t border-border/70 pt-4">
                <p className="text-sm font-medium">Storage diagnostics</p>
                {storage.map((entry) => (
                  <div key={entry.root} className="flex flex-wrap items-center gap-2 text-xs">
                    {entry.exists && entry.writable ? (
                      <CheckCircle2 className="size-3.5 text-status-completed" aria-hidden />
                    ) : (
                      <XCircle className="size-3.5 text-status-failed" aria-hidden />
                    )}
                    <span className="font-mono text-[11px]">{entry.root}</span>
                    <Badge variant="neutral">{entry.itemCount} files</Badge>
                    <Badge variant="outline">{formatBytes(entry.bytes)}</Badge>
                    {entry.error ? <span className="text-status-failed">{entry.error}</span> : null}
                    {!entry.exists ? <span className="text-status-paused">does not exist yet</span> : null}
                  </div>
                ))}
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <HardDrive className="size-3.5" aria-hidden />
                  {formatBytes(s.disk.freeBytes)} free of {formatBytes(s.disk.totalBytes)} on {s.disk.path}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ---------------------- metadata & availability ------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wand2 className="size-4 text-primary" aria-hidden />
                Metadata &amp; availability
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tmdb-region">TMDB region</Label>
                  <Input
                    id="tmdb-region"
                    value={tmdbRegion}
                    maxLength={2}
                    onChange={(event) => setTmdbRegion(event.target.value.toUpperCase())}
                    className="w-24 uppercase"
                  />
                  <p className="text-xs text-muted-foreground">Two-letter code, e.g. NG.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="watchmode-region">Availability region</Label>
                  <Input
                    id="watchmode-region"
                    value={watchmodeRegion}
                    maxLength={2}
                    onChange={(event) => setWatchmodeRegion(event.target.value.toUpperCase())}
                    className="w-24 uppercase"
                  />
                  <p className="text-xs text-muted-foreground">Used by Watchmode when a key is present.</p>
                </div>
              </div>

              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ tmdbRegion, watchmodeRegion })}
              >
                {update.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                Save regions
              </Button>

              <div className="space-y-2 border-t border-border/70 pt-4 text-xs">
                <p className="text-sm font-medium">Configured credentials (server-side)</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={health.data?.capabilities.tmdb ? 'success' : 'warning'}>
                    {health.data?.capabilities.tmdb ? 'TMDB key present' : 'No TMDB key'}
                  </Badge>
                  <Badge variant={health.data?.capabilities.watchmode ? 'success' : 'warning'}>
                    {health.data?.capabilities.watchmode ? 'Watchmode key present' : 'No Watchmode key'}
                  </Badge>
                  <Badge variant={s.aria2SecretConfigured ? 'success' : 'neutral'}>
                    {s.aria2SecretConfigured ? 'aria2 RPC secret set' : 'No aria2 secret'}
                  </Badge>
                </div>
                <p className="flex items-start gap-2 text-muted-foreground">
                  <Lock className="mt-px size-3.5 shrink-0" aria-hidden />
                  Keys live in <span className="font-mono">.env</span> on the server. They are never returned by an API response, never logged, and
                  never bundled into the frontend.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ------------------------------ engine ---------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="size-4 text-primary" aria-hidden />
                Download engine
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="aria2-toggle">Prefer aria2 when available</Label>
                  <p className="text-xs text-muted-foreground">
                    Requires <span className="font-mono">DOWNLOAD_ENGINE=aria2</span> and a localhost aria2c with RPC enabled. The browser never talks
                    to aria2 directly.
                  </p>
                </div>
                <Switch id="aria2-toggle" checked={aria2Enabled} onCheckedChange={setAria2Enabled} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="aria2-url">aria2 JSON-RPC URL</Label>
                <Input
                  id="aria2-url"
                  value={aria2RpcUrl}
                  onChange={(event) => setAria2RpcUrl(event.target.value)}
                  spellCheck={false}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">Loopback only — remote RPC endpoints are rejected.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={health.data?.capabilities.aria2 ? 'success' : 'neutral'}>
                  {health.data?.capabilities.aria2 ? 'aria2 active' : 'Native worker active'}
                </Badge>
                <Badge variant={health.data?.capabilities.ffprobe ? 'success' : 'warning'}>
                  {health.data?.capabilities.ffprobe ? 'ffprobe detected' : 'ffprobe missing — shallow probes'}
                </Badge>
                <Badge variant={health.data?.capabilities.ffmpeg ? 'success' : 'neutral'}>
                  {health.data?.capabilities.ffmpeg ? 'ffmpeg detected' : 'ffmpeg not installed'}
                </Badge>
              </div>

              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ aria2Enabled, aria2RpcUrl })}
              >
                {update.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
                Save engine settings
              </Button>

              {!health.data?.capabilities.ffprobe ? (
                <Alert variant="warning">
                  <AlertTriangle />
                  <AlertTitle>ffprobe is not installed</AlertTitle>
                  <AlertDescription>
                    Duration, codecs and resolution cannot be read, so BlaxkVault falls back to magic-byte container sniffing and says so in the UI.
                    Install ffmpeg to get full probes.
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          {/* --------------------------- experience --------------------------- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" aria-hidden />
                Experience
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="theme-select">Theme</Label>
                  <Select
                    value={theme}
                    onValueChange={(value) => {
                      setTheme(value as 'dark' | 'light' | 'system');
                      update.mutate({ theme: value as 'dark' | 'light' | 'system' });
                    }}
                  >
                    <SelectTrigger id="theme-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Dark (recommended)</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="system">Follow my system</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="motion-select">Motion</Label>
                  <Select
                    value={motion}
                    onValueChange={(value) => {
                      setMotion(value as 'system' | 'reduce' | 'allow');
                      update.mutate({ reducedMotion: value as 'system' | 'reduce' | 'allow' });
                    }}
                  >
                    <SelectTrigger id="motion-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">Follow my system</SelectItem>
                      <SelectItem value="reduce">Always reduce</SelectItem>
                      <SelectItem value="allow">Always allow</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                Your system currently {reducedNow ? 'requests' : 'does not request'} reduced motion. GSAP timelines and CSS transitions both honour this
                setting — animations are skipped rather than slowed down.
              </p>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <QueueLimits />
          <div className="surface rounded-xl p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-2 text-sm font-medium text-foreground">Environment-only settings</p>
            <ul className="space-y-1.5">
              <li>· <span className="font-mono">BLAXKVAULT_ACCESS_TOKEN</span> — required for any non-loopback access.</li>
              <li>· <span className="font-mono">TMDB_API_KEY</span>, <span className="font-mono">WATCHMODE_API_KEY</span></li>
              <li>· <span className="font-mono">ARIA2_RPC_SECRET</span>, <span className="font-mono">ARIA2_RPC_URL</span></li>
              <li>· <span className="font-mono">ALLOW_PRIVATE_ADDRESSES</span> — keep false to block SSRF targets.</li>
              <li>· <span className="font-mono">ALLOWED_HTTP_HOSTS</span> — optional allowlist for direct links.</li>
            </ul>
            <p className="mt-2">See <span className="font-mono">.env.example</span> in the repository for the full annotated list.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
