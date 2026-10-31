/**
 * Root composition: providers, theme/motion wiring and routes.
 *
 * The theme is applied as a class on <html> and the motion preference as a data
 * attribute, which is what the CSS tokens and `prefersReducedMotion()` read.
 * Both are persisted on the server too, so a second device inherits them.
 */
import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AppShell } from '@/components/app/AppShell';
import { Toaster } from '@/components/ui/sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DiscoverPage } from '@/pages/DiscoverPage';
import { TitlePage } from '@/pages/TitlePage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { WatchPage } from '@/pages/WatchPage';
import { SourcesPage } from '@/pages/SourcesPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { useSettings } from '@/api/hooks';
import { useUiStore } from '@/store/ui';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      gcTime: 10 * 60_000,
    },
  },
});

/** A render failure must explain itself rather than leaving a blank screen. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Console only — never ship component stacks to the server.
    console.error('BlaxkVault UI error:', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl py-10">
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>The interface hit an unexpected error</AlertTitle>
            <AlertDescription className="space-y-3">
              <p>{this.state.error.message}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>
                  <RefreshCw className="size-3.5" aria-hidden />
                  Try rendering again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => window.location.reload()}>
                  Reload the app
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    return this.props.children;
  }
}

function ThemeSync() {
  const theme = useUiStore((state) => state.theme);
  const motion = useUiStore((state) => state.motion);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
      root.classList.toggle('light', resolved === 'light');
      root.classList.toggle('dark', resolved !== 'light');
    };
    apply();
    if (theme === 'system') {
      const media = window.matchMedia('(prefers-color-scheme: light)');
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
    return undefined;
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
    document.dispatchEvent(new Event('blaxkvault:motion-change'));
  }, [motion]);

  return null;
}

function ServerSettingsSync() {
  const { data } = useSettings();
  const setTheme = useUiStore((state) => state.setTheme);
  const setMotion = useUiStore((state) => state.setMotion);
  const theme = useUiStore((state) => state.theme);
  const motion = useUiStore((state) => state.motion);

  useEffect(() => {
    const settings = data?.settings;
    if (!settings) return;
    // Adopt server values only when this device has no explicit local choice yet.
    if (settings.theme !== theme && theme === 'dark' && settings.theme !== 'dark') setTheme(settings.theme);
    if (settings.reducedMotion !== motion && motion === 'system' && settings.reducedMotion !== 'system') setMotion(settings.reducedMotion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeSync />
        <ServerSettingsSync />
        <ErrorBoundary>
          <Routes>
            <Route element={<AppShell />}>
              <Route index element={<DiscoverPage />} />
              <Route path="/title/:id" element={<TitlePage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/watch/:id" element={<WatchPage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/discover" element={<Navigate to="/" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </ErrorBoundary>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
