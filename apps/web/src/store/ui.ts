/**
 * Zustand is used only for genuine UI state: which panels are open, how the
 * user wants motion, and the last search they typed. Server data lives in
 * TanStack Query (blueprint §2: "Zustand only where needed").
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeChoice = 'dark' | 'light' | 'system';
export type MotionChoice = 'system' | 'reduce' | 'allow';

interface UiState {
  commandOpen: boolean;
  mobileNavOpen: boolean;
  sidebarCollapsed: boolean;
  theme: ThemeChoice;
  motion: MotionChoice;
  recentSearches: string[];
  setCommandOpen: (open: boolean) => void;
  setMobileNavOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setTheme: (theme: ThemeChoice) => void;
  setMotion: (motion: MotionChoice) => void;
  rememberSearch: (query: string) => void;
  clearRecentSearches: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      commandOpen: false,
      mobileNavOpen: false,
      sidebarCollapsed: false,
      theme: 'dark',
      motion: 'system',
      recentSearches: [],
      setCommandOpen: (commandOpen) => set({ commandOpen }),
      setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setTheme: (theme) => set({ theme }),
      setMotion: (motion) => set({ motion }),
      rememberSearch: (query) =>
        set((state) => {
          const trimmed = query.trim();
          if (trimmed.length < 2) return state;
          return { recentSearches: [trimmed, ...state.recentSearches.filter((q) => q !== trimmed)].slice(0, 6) };
        }),
      clearRecentSearches: () => set({ recentSearches: [] }),
    }),
    {
      name: 'blaxkvault-ui',
      partialize: (state) => ({
        theme: state.theme,
        motion: state.motion,
        sidebarCollapsed: state.sidebarCollapsed,
        recentSearches: state.recentSearches,
      }),
    },
  ),
);
