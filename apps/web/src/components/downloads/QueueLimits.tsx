/**
 * Live queue limits.
 *
 * Writes straight to PATCH /api/settings, which pushes the new values into the
 * running manager — concurrency changes take effect on the next pump without a
 * restart. Bandwidth is a real token-bucket throttle in the worker.
 */
import { useEffect, useState } from 'react';
import { Gauge, Loader2, Save, Waves } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useSettings, useUpdateSettings } from '@/api/hooks';
import { formatBytes } from '@/lib/format';

export function QueueLimits() {
  const { data, isLoading } = useSettings();
  const update = useUpdateSettings();
  const [concurrency, setConcurrency] = useState<number[]>([]);
  const [bandwidth, setBandwidth] = useState<number[]>([]);
  const [cap, setCap] = useState<number[]>([]);

  const settings = data?.settings;

  useEffect(() => {
    if (!settings) return;
    setConcurrency([settings.maxConcurrentDownloads]);
    setBandwidth([settings.bandwidthLimitKbps]);
    setCap([Math.round((settings.maxDownloadBytes || 0) / (1024 * 1024 * 1024) * 10) / 10]);
  }, [settings]);

  const dirty =
    settings !== undefined &&
    (concurrency[0] !== settings.maxConcurrentDownloads ||
      bandwidth[0] !== settings.bandwidthLimitKbps ||
      Math.round((settings.maxDownloadBytes || 0) / (1024 ** 3) * 10) / 10 !== cap[0]);

  if (isLoading || !settings) {
    return (
      <div className="surface flex items-center gap-2 rounded-xl p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading queue limits…
      </div>
    );
  }

  return (
    <div className="surface space-y-5 rounded-xl p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="concurrency" className="gap-2">
            <Gauge className="size-4 text-primary" aria-hidden />
            Simultaneous downloads
          </Label>
          <span className="text-sm tabular-nums">{concurrency[0]} of 8</span>
        </div>
        <Slider
          id="concurrency"
          min={1}
          max={8}
          step={1}
          value={concurrency}
          onValueChange={setConcurrency}
          aria-label="Maximum simultaneous downloads"
        />
        <p className="text-xs text-muted-foreground">Extra jobs stay queued and start as slots free up.</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="bandwidth" className="gap-2">
            <Waves className="size-4 text-primary" aria-hidden />
            Bandwidth limit
          </Label>
          <span className="text-sm tabular-nums">{bandwidth[0] === 0 ? 'Unlimited' : `${bandwidth[0]} KB/s`}</span>
        </div>
        <Slider
          id="bandwidth"
          min={0}
          max={20_000}
          step={250}
          value={bandwidth}
          onValueChange={setBandwidth}
          aria-label="Bandwidth limit in kilobytes per second"
        />
        <p className="text-xs text-muted-foreground">Applied per transfer. Set 0 for unlimited.</p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="cap" className="gap-2">
            <Save className="size-4 text-primary" aria-hidden />
            Per-file size cap
          </Label>
          <span className="text-sm tabular-nums">{cap[0] === 0 ? 'No cap' : `${cap[0]} GB`}</span>
        </div>
        <Slider id="cap" min={0} max={40} step={0.5} value={cap} onValueChange={setCap} aria-label="Per-file size cap in gigabytes" />
        <p className="text-xs text-muted-foreground">
          A file larger than the cap is refused before it starts, and aborted mid-transfer if the server under-reported its size. Current cap:{' '}
          {settings.maxDownloadBytes ? formatBytes(settings.maxDownloadBytes) : 'none'}.
        </p>
      </div>

      <Button
        size="sm"
        disabled={!dirty || update.isPending}
        onClick={() =>
          update.mutate({
            maxConcurrentDownloads: concurrency[0],
            bandwidthLimitKbps: bandwidth[0],
            maxDownloadBytes: Math.round((cap[0] ?? 0) * 1024 ** 3),
          })
        }
      >
        {update.isPending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Save className="size-3.5" aria-hidden />}
        Apply limits
      </Button>
    </div>
  );
}
