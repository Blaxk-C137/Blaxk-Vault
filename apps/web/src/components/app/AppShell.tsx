/**
 * App shell: navigation, page frame and live system status.
 *
 * Navigation has three shapes so nothing is hover-only or hidden on touch:
 *   - a collapsible rail on large screens (real collapse state, GSAP-driven
 *     active indicator),
 *   - a top bar with the search trigger and live connection state,
 *   - a bottom tab bar on small screens plus a sheet for the secondary routes.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ChevronLeft,
  CircleDot,
  Clapperboard,
  Compass,
  DownloadCloud,
  HardDrive,
  Library,
  Menu,
  Moon,
  Plug,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useHealth, useStats } from '@/api/hooks';
import { useRealtime } from '@/api/ws';
import { formatBytes, formatSpeed } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui';
import { gsap, useGSAP } from '@/lib/gsap';
import { CommandPalette } from './CommandPalette';

const NAV = [
  { to: '/', label: 'Discover', icon: Compass, exact: true },
  { to: '/downloads', label: 'Downloads', icon: DownloadCloud },
  { to: '/library', label: 'Library', icon: Library },
  { to: '/sources', label: 'Sources', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Logo({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-2.5 rounded-md px-2 py-1.5" aria-label="BlaxkVault home">
      <span className="relative inline-flex size-8 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/40">
        <Clapperboard className="size-4 text-primary" aria-hidden />
      </span>
      {!collapsed ? (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">BlaxkVault</span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Discover · Keep</span>
        </span>
      ) : null}
    </Link>
  );
}

function ConnectionPill() {
  const { state } = useRealtime();
  const label = state === 'open' ? 'Live' : state === 'connecting' ? 'Connecting' : 'Offline';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
            state === 'open' && 'border-status-completed/40 bg-status-completed/10 text-status-completed',
            state === 'connecting' && 'border-status-paused/40 bg-status-paused/10 text-status-paused',
            state === 'closed' && 'border-status-failed/40 bg-status-failed/10 text-status-failed',
          )}
          role="status"
          aria-live="polite"
        >
          <CircleDot className="size-3" aria-hidden />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {state === 'open'
          ? 'WebSocket connected — download progress and library updates stream in real time.'
          : state === 'connecting'
            ? 'Opening the realtime channel to the BlaxkVault server…'
            : 'Realtime channel closed. The client is retrying with backoff; REST still works.'}
      </TooltipContent>
    </Tooltip>
  );
}

function EngineStrip() {
  const { data: health } = useHealth();
  const { data: stats } = useStats();
  const fixture = health?.mode === 'fixture';

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/50 p-3 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Engine</span>
        <span className="font-medium">{health?.capabilities.aria2 ? 'aria2 (localhost RPC)' : 'Native worker'}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Metadata</span>
        <span className={cn('font-medium', fixture && 'text-status-paused')}>{fixture ? 'Sample catalogue' : 'TMDB live'}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Transfer</span>
        <span className="font-medium">{stats?.totalSpeedBps ? formatSpeed(stats.totalSpeedBps) : 'Idle'}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Library</span>
        <span className="font-medium">
          {stats?.libraryItems ?? 0} files · {formatBytes(stats?.libraryBytes ?? 0)}
        </span>
      </div>
      {stats?.disk.freeBytes !== undefined ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Free space</span>
          <span className="font-medium">{formatBytes(stats.disk.freeBytes)}</span>
        </div>
      ) : null}
      {stats?.disk.freeBytes !== undefined && stats.disk.freeBytes < 2 * 1024 ** 3 ? (
        <p className="flex items-start gap-1.5 text-status-paused">
          <AlertTriangle className="mt-px size-3 shrink-0" aria-hidden />
          Low disk space — downloads will fail with a clear error rather than corrupting files.
        </p>
      ) : null}
    </div>
  );
}

/** GSAP page transition: a short, deliberate fade/slide, skipped for reduced motion. */
function PageTransition({ children, routeKey }: { children: React.ReactNode; routeKey: string }) {
  const container = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.fromTo(container.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out', clearProps: 'transform' });
      });
      return () => mm.revert();
    },
    { dependencies: [routeKey], scope: container },
  );

  return (
    <div ref={container} className="gsap-animatable min-h-full">
      {children}
    </div>
  );
}

export function AppShell() {
  const location = useLocation();
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  const setCommandOpen = useUiStore((state) => state.setCommandOpen);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Global shortcut: ⌘K / Ctrl-K opens the palette from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setCommandOpen]);

  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-dvh bg-background">
        {/* ------------------------------ desktop rail ------------------------------ */}
        <aside
          className={cn(
            'sticky top-0 hidden h-dvh shrink-0 flex-col justify-between border-r border-border/80 bg-card/30 px-2 py-3 transition-[width] duration-200 lg:flex',
            sidebarCollapsed ? 'w-[68px]' : 'w-[236px]',
          )}
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Logo collapsed={sidebarCollapsed} />
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                aria-label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
                aria-expanded={!sidebarCollapsed}
              >
                <ChevronLeft className={cn('size-4 transition-transform', sidebarCollapsed && 'rotate-180')} aria-hidden />
              </Button>
            </div>

            <nav aria-label="Primary" className="flex flex-col gap-0.5">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.exact}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                      'text-muted-foreground hover:bg-accent/70 hover:text-foreground',
                      isActive && 'bg-accent text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive ? (
                        <span className="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-primary" aria-hidden />
                      ) : null}
                      <item.icon className={cn('size-4 shrink-0', isActive && 'text-primary')} aria-hidden />
                      {!sidebarCollapsed ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
                    </>
                  )}
                </NavLink>
              ))}
            </nav>
          </div>

          {!sidebarCollapsed ? <EngineStrip /> : null}
        </aside>

        {/* ---------------------------------- main --------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border/80 bg-background/85 px-3 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/70 lg:px-6">
            <div className="lg:hidden">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Open navigation">
                    <Menu className="size-5" aria-hidden />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72">
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <Logo />
                  <nav aria-label="Mobile" className="mt-2 flex flex-col gap-1">
                    {NAV.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.exact}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) =>
                          cn('flex items-center gap-3 rounded-md px-2.5 py-2.5 text-sm', isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/60')
                        }
                      >
                        <item.icon className="size-4" aria-hidden />
                        {item.label}
                      </NavLink>
                    ))}
                  </nav>
                  <div className="mt-auto">
                    <EngineStrip />
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <Button
              variant="outline"
              onClick={() => setCommandOpen(true)}
              className="h-9 flex-1 justify-start gap-2.5 text-muted-foreground sm:max-w-md"
              aria-label="Search titles and commands"
            >
              <Search className="size-4" aria-hidden />
              <span className="truncate text-sm">Search films, series, commands…</span>
              <kbd className="ml-auto hidden rounded border border-border bg-secondary/60 px-1.5 py-0.5 font-sans text-[10px] tracking-wide sm:inline-block">
                ⌘K
              </kbd>
            </Button>

            <div className="ml-auto flex items-center gap-2">
              <ConnectionPill />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setTheme(nextTheme)} aria-label={`Switch to ${nextTheme} theme`}>
                    {theme === 'dark' ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Switch to the {nextTheme} theme</TooltipContent>
              </Tooltip>
            </div>
          </header>

          <main id="main" className="flex-1 px-3 pb-24 pt-4 lg:px-6 lg:pb-10">
            <PageTransition routeKey={location.pathname}>
              <Outlet />
            </PageTransition>
          </main>

          {/* ---------------------------- mobile tab bar ---------------------------- */}
          <nav
            aria-label="Primary"
            className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-border/80 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
          >
            {[NAV[0]!, NAV[1]!, NAV[2]!, NAV[4]!].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                className={({ isActive }) =>
                  cn('flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px]', isActive ? 'text-primary' : 'text-muted-foreground')
                }
              >
                <item.icon className="size-5" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <CommandPalette />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          Skip to main content
        </a>
      </div>
    </TooltipProvider>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
  badge,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 border-b border-border/70 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {breadcrumb ? <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">{breadcrumb}</div> : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="display-tight text-xl sm:text-2xl">{title}</h1>
          {badge}
        </div>
        {description ? <p className="max-w-3xl text-sm text-muted-foreground text-balance">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatusBadge({ state }: { state: 'live' | 'fixture' | 'unknown' }) {
  if (state === 'live') return <Badge variant="success">Live metadata</Badge>;
  if (state === 'fixture') return <Badge variant="warning">Sample catalogue</Badge>;
  return <Badge variant="neutral">Unknown</Badge>;
}

export { Activity, HardDrive };
