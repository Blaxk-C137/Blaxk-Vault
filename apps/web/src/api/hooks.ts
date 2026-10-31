/**
 * TanStack Query hooks — all server state. Keys are centralised so the WebSocket
 * layer can patch the same caches the UI reads from.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { CreateDownloadInput, DownloadJob, SettingsPatch } from '@blaxkvault/shared';
import { toast } from 'sonner';
import { ApiError, api } from './client';

export const queryKeys = {
  health: ['health'] as const,
  stats: ['stats'] as const,
  trending: ['trending'] as const,
  search: (q: string, kind: string, page: number) => ['search', q, kind, page] as const,
  title: (id: string) => ['title', id] as const,
  season: (id: string, season: number) => ['season', id, season] as const,
  availability: (id: string) => ['availability', id] as const,
  localCopies: (id: string) => ['local-copies', id] as const,
  downloadability: (id: string) => ['downloadability', id] as const,
  sources: ['sources'] as const,
  jobs: ['jobs'] as const,
  library: (params: Record<string, string | undefined>) => ['library', params] as const,
  libraryItem: (id: string) => ['library-item', id] as const,
  settings: ['settings'] as const,
  archiveSearch: (q: string, page: number) => ['archive-search', q, page] as const,
};

/** Shared error copy so every screen explains failures the same honest way. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

function useToastOnError() {
  return (error: unknown) => {
    if (error instanceof ApiError && error.status === 0) return; // offline banner already shows this
    toast.error(errorMessage(error));
  };
}

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: api.health, staleTime: 30_000, refetchInterval: 60_000, retry: 1 });
}

export function useStats() {
  return useQuery({ queryKey: queryKeys.stats, queryFn: api.stats, staleTime: 5_000, refetchInterval: 15_000 });
}

export function useTrending(options?: Partial<UseQueryOptions<Awaited<ReturnType<typeof api.trending>>>>) {
  return useQuery({ queryKey: queryKeys.trending, queryFn: api.trending, staleTime: 5 * 60_000, ...options });
}

export function useSearch(query: string, kind: 'multi' | 'movie' | 'tv', page: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.search(query, kind, page),
    queryFn: () => api.search(query, kind, page),
    enabled: enabled && query.trim().length > 1,
    // Results for the same query are cached; a stale search is cancelled by the
    // query key changing rather than by racing requests (§10).
    staleTime: 2 * 60_000,
    placeholderData: (previous) => previous,
    retry: 1,
  });
}

export function useTitle(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.title(id ?? ''),
    queryFn: () => api.title(id!),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.isMissing) && count < 2,
  });
}

export function useSeason(id: string | undefined, seasonNumber: number | undefined) {
  return useQuery({
    queryKey: queryKeys.season(id ?? '', seasonNumber ?? -1),
    queryFn: () => api.season(id!, seasonNumber!),
    enabled: Boolean(id) && seasonNumber !== undefined,
    staleTime: 10 * 60_000,
  });
}

export function useAvailability(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.availability(id ?? ''),
    queryFn: () => api.availability(id!),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
  });
}

/**
 * Downloadability is deliberately NOT auto-fetched on page load: it performs a
 * real archive.org search plus item metadata reads. The user asks for it with a
 * button and sees the timestamped verdict.
 */
export function useDownloadability(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.downloadability(id ?? ''),
    queryFn: () => api.downloadability(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
    retry: 0,
  });
}

/**
 * Local copies of a catalogue title. Enabled lazily — the title screen only asks
 * once the user shows interest in playing or downloading, so browsing stays cheap.
 */
export function useLocalCopies(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.localCopies(id ?? ''),
    queryFn: () => api.localCopies(id!),
    enabled: Boolean(id) && enabled,
    staleTime: 30_000,
  });
}

export function useSources() {
  return useQuery({ queryKey: queryKeys.sources, queryFn: api.sources, staleTime: 5 * 60_000 });
}

export function useJobs() {
  return useQuery({ queryKey: queryKeys.jobs, queryFn: api.jobs, refetchInterval: 30_000, staleTime: 1_000 });
}

export function useLibrary(params: { q?: string; kind?: string; sort?: string }) {
  return useQuery({
    queryKey: queryKeys.library(params),
    queryFn: () => api.library(params),
    staleTime: 15_000,
  });
}

export function useLibraryItem(id: string | undefined) {
  return useQuery({ queryKey: queryKeys.libraryItem(id ?? ''), queryFn: () => api.libraryItem(id!), enabled: Boolean(id) });
}

export function useSettings() {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.settings, staleTime: 30_000 });
}

export function useArchiveSearch(query: string, page: number, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.archiveSearch(query, page),
    queryFn: () => api.archiveSearch(query, page),
    enabled: enabled && query.trim().length > 2,
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------- mutations -------------------------------- */

export function useJobMutations() {
  const queryClient = useQueryClient();
  const onError = useToastOnError();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.jobs });
    void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
  };

  const patchJob = (job: DownloadJob) => {
    queryClient.setQueryData<{ jobs: DownloadJob[] } | undefined>(queryKeys.jobs, (previous) =>
      previous ? { ...previous, jobs: previous.jobs.map((j) => (j.id === job.id ? job : j)) } : previous,
    );
  };

  const action = (label: string, run: (id: string) => Promise<{ job: DownloadJob }>, successMessage?: string) =>
    useMutation({
      mutationFn: run,
      onSuccess: ({ job }, _variables, context) => {
        patchJob(job);
        invalidate();
        if (successMessage) toast.success(successMessage);
        void label;
        void context;
      },
      onError,
    });

  const pause = action('pause', api.pauseDownload, 'Download paused.');
  const resume = action('resume', api.resumeDownload, 'Download resumed.');
  const cancel = action('cancel', api.cancelDownload, 'Download cancelled. The partial file was removed.');
  const retry = action('retry', api.retryDownload, 'Retrying the download.');

  const create = useMutation({
    mutationFn: (input: CreateDownloadInput) => api.createDownload(input),
    onSuccess: ({ job }) => {
      toast.success(`Queued ${job.fileName}.`, { description: 'Progress updates arrive live.' });
      invalidate();
    },
    onError,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.removeDownload(id),
    onSuccess: (result) => {
      toast.success(result.message ?? 'Removed from history. The file was kept.');
      invalidate();
    },
    onError,
  });

  const deleteFile = useMutation({
    mutationFn: (id: string) => api.deleteDownloadFile(id),
    onSuccess: (result) => {
      toast.success(result.message ?? 'The stored file was deleted.');
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError,
  });

  return { create, pause, resume, cancel, retry, remove, deleteFile };
}

export function useScanLibrary() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.scanLibrary,
    onSuccess: ({ result }) => {
      toast.success(`Rescan finished — ${result.fileCount} media file${result.fileCount === 1 ? '' : 's'} in ${Math.round(result.durationMs)} ms.`, {
        description: result.removedItems > 0 ? `${result.removedItems} file(s) are now missing from disk.` : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
    onError: useToastOnError(),
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.patchSettings(patch),
    onSuccess: ({ settings, warnings }) => {
      queryClient.setQueryData(queryKeys.settings, { settings, storage: [] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      toast.success('Settings saved.', { description: warnings.length ? warnings.join(' ') : undefined });
    },
    onError: useToastOnError(),
  });
}

export function useInspect() {
  return useMutation({ mutationFn: (input: { url: string; context?: Parameters<typeof api.inspect>[1] }) => api.inspect(input.url, input.context), onError: useToastOnError() });
}

export function useEpisodeDownloadability() {
  return useMutation({ mutationFn: api.episodeDownloadability, onError: useToastOnError() });
}

export function useSaveProgress() {
  return useMutation({
    mutationFn: ({ id, positionSeconds, durationSeconds, completed }: { id: string; positionSeconds: number; durationSeconds?: number; completed?: boolean }) =>
      api.saveProgress(id, { positionSeconds, durationSeconds, completed }),
    onError: () => undefined, // progress is best-effort; never nag the viewer mid-film
  });
}
