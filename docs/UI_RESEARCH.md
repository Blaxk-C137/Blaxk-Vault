# BlaxkVault — UI research & design decisions

> Scope: this document records the research the blueprint asked for (GSAP, shadcn/ui,
> 21st.dev, ThreeUI, TasteSkill, and a verified React player), what was checked, what
> was **verified** versus what could not be verified from this environment, the licence
> of every component source we rely on, and the motion rules the implementation obeys.
>
> Research date for everything below: **2026-10-15**. Licences were read from the
> installed packages in `node_modules` wherever the package is actually a dependency.

---

## 1. Method and honesty notes

Two constraints shaped how this research was done, and both are stated here rather than
hidden in a commit message:

1. **Some sources could not be fetched.** `https://gsap.com/docs/v3/React/` returns
   `403 Forbidden` to the fetch tool. The canonical React guidance was taken from
   `https://gsap.com/react` instead, and the API surface was confirmed against the
   installed type definitions.
2. **The `shadcn` CLI was not run.** It downloads component source from the network at
   add-time. Instead of guessing at CLI output, the primitives in
   `apps/web/src/components/ui/` are vendored in the shadcn idiom — the documented
   structure: MIT-licensed source copied into the project, `cn()` composition helper,
   `class-variance-authority` variants, Radix primitives underneath, CSS custom
   properties for theming. They are *our* files with *our* vocabulary, which is exactly
   what `shadcn add` would produce, minus the network round-trip.

Anything below that could not be verified is labelled **unverified** rather than
presented as fact. Where a licence is not what a reader might assume (GSAP), it is
called out explicitly.

---

## 2. Verified component & library sources

| Source | URL | Licence (as verified) | How BlaxkVault uses it |
| --- | --- | --- | --- |
| shadcn/ui | `https://ui.shadcn.com` · docs `https://ui.shadcn.com/docs` | MIT (source copied into the project, not a runtime dependency) | The whole primitive layer: button, badge, card, dialog, dropdown-menu, input, label, progress, scroll-area, select, separator, skeleton, slider, switch, tabs, tooltip, command. Token names (`--background`, `--card`, `--primary`, `--ring`, `--radius`…) follow the shadcn convention so future `shadcn add` calls drop in cleanly. |
| shadcn/ui · Command | `https://ui.shadcn.com/docs/components/base/command` | MIT | The `⌘K` command palette (`cmdk` + `Dialog`). The blueprint's "fast keyboard navigation" requirement. Note: the install-command block rendered empty when fetched, so the CLI syntax was not copied from the page. |
| Radix UI | `https://www.radix-ui.com/primitives` (packages: `@radix-ui/react-*`) | MIT (verified in `node_modules`) | Accessibility substrate for dialog, tabs, select, slider, switch, tooltip, dropdown, separator, progress, scroll-area, label, checkbox, popover, slot. |
| `cmdk` | `https://github.com/pacocoursey/cmdk` | MIT v1.1.1 | Fuzzy search engine behind the command palette. |
| `sonner` | `https://github.com/emilkowalski/sonner` | MIT v2.0.8 | Toasts for real events only (job completed, job failed, license confirmed). |
| `vaul` | `https://github.com/emilkowalski/vaul` | MIT v1.1.2 | Bottom-sheet behaviour for mobile filter/queue drawers. |
| `lucide-react` | `https://lucide.dev` | **ISC** v1.57.0 | The entire icon set. |
| `class-variance-authority` | `https://cva.style` | Apache-2.0 v0.7.1 | Variant composition for Button/Badge/StatusPill. |
| `tailwind-merge` + `clsx` | `https://github.com/dcastil/tailwind-merge` · `https://github.com/lukeed/clsx` | MIT | The `cn()` helper — shadcn's standard conflict-resolution pairing. |
| Tailwind CSS v4 | `https://tailwindcss.com` | MIT v4.3.3 | Utility engine; wired through the first-party `@tailwindcss/vite` plugin. |
| `tw-animate-css` | `https://github.com/Wombosvideo/tw-animate-css` | MIT v1.4.0 | Small CSS entrance/skeleton animations where JS would be overkill. |
| GSAP | `https://gsap.com` · repo `https://github.com/greensock/GSAP` · React guide `https://gsap.com/react` | **GreenSock Standard "No Charge" licence** — `https://gsap.com/standard-license` (verified in the installed `package.json`; **this is not MIT**) | Signature interactions only (see §4). |
| `@gsap/react` | `https://gsap.com/react` | Same Standard "No Charge" licence (`SEE LICENSE AT https://gsap.com/standard-license`) v2.1.2 | `useGSAP()` hook: automatic context/cleanup on unmount, which is the blueprint's explicit requirement. |
| Vidstack | `https://vidstack.io` · repo `https://github.com/vidstack/vidstack` | MIT v1.15.7 (verified in `node_modules`) | The offline player on the Watch screen (see §5). |
| Video.js 10 | `https://videojs.org/docs/framework/react/` | Apache-2.0, `@videojs/react` v10.1.0 | Evaluated as Vidstack's designated successor; **not** shipped (see §5). |
| ThreeUI | `https://threeui.com` · repo `https://github.com/MengTo/threeui` · npm `@designcodeio/threeui` | MIT v1.2.0 (repo + npm package) | **Evaluated, not used** (see §7). Community tier: 50 parent components / 141 free variants; peer deps React ≥18.2 and `three` ≥0.149. |
| TasteSkill | `https://tasteskill.dev` · repo `https://github.com/Leonxlnx/taste-skill` | MIT | **Guidance only, no components**: an agent `SKILL.md` bundle for design judgement, installed with `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"`. Its dials (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY) informed the restraint described in §3–§4. |
| 21st.dev | `https://21st.dev` | **Per-component** — every submission carries its own licence; there is no site-wide licence | **Reference only, no code copied** (see §6). |

### GSAP licence, stated plainly

GSAP 3.15.0 is free for the use this project makes of it, but the licence is the
GreenSock Standard "No Charge" licence, not MIT/Apache-2.0. It is not an OSI licence and
it carries terms around competing/derivative products that MIT does not have. BlaxkVault
uses only the free core (`gsap`) and `@gsap/react`; no Club-only plugins are required by
this codebase. Anyone forking BlaxkVault for commercial redistribution should read
`https://gsap.com/standard-license` first — the rest of the stack (MIT/Apache/ISC) is
unaffected by that reading.

---

## 3. Design direction

**Positioning.** "Discover. Download. Watch. Keep." — a vault, not a storefront. The UI
should feel like a well-kept private collection: dark, quiet, precise, with metadata
treated as first-class content rather than decoration.

**Tokens** (all defined once in `apps/web/src/styles/index.css`, dark is canonical,
`.light` overrides):

| Token | Dark | Role |
| --- | --- | --- |
| `--background` | `oklch(0.145 0.008 285)` | Page canvas — near-black with a violet-cold cast, never pure `#000`. |
| `--card` / `--popover` | `oklch(0.185 …)` / `oklch(0.165 …)` | Raised surfaces. Two levels only. |
| `--primary` | `oklch(0.62 0.19 293)` | Restrained violet accent, used for primary actions and focus. |
| `--muted-foreground` | `oklch(0.70 0.012 285)` | Secondary text that still passes contrast on `--background`. |
| `--status-*` | queued / downloading / paused / completed / failed / cancelled / unknown | **Only** for real download and library states. Colour is never used to imply progress that doesn't exist. |
| `--radius` | `0.75rem` with `--radius-sm/md/lg/xl` derivatives | One radius family everywhere. |

**Deliberate exclusions** (each a rule, not an oversight): no gradients-as-content, no
glassmorphism on list rows, no glowing borders, no animated background behind text, no
emoji as icons, no drop shadows on flat surfaces, no autoplaying motion on the Discover
grid beyond one 400 ms stagger.

**Typography.** System stack only (`ui-sans-serif, system-ui, …`). No webfont is
downloaded: it keeps first paint fast, avoids a third-party request, and keeps the CSP
tight (`default-src 'self'`). Display headings use `--tracking-display: -0.022em`.

**Layout.** 12-column grid at `≥1280px`, 8 at `≥768px`, 4 below. Poster grid: 2 columns
at 360 px, 3 at 640 px, 4–5 at 1024 px, 6 at 1536 px. Media queries are expressed once
(`hooks/useMediaQuery.ts`) so the JS and CSS breakpoints cannot drift.

**Density.** Rows are 56–72 px tall, 24 px gutters on desktop, 16 px on mobile. Touch
targets are ≥44 px on mobile — the *same* components ship to both, they are not two
separate UIs.

---

## 4. Motion plan (GSAP)

The blueprint is explicit: GSAP for a few signature interactions, CSS for simple
hover/focus, never animate hundreds of cards, never hijack scroll. That is implemented
literally in `apps/web/src/lib/gsap.ts`:

```
gsap.registerPlugin(ScrollTrigger, useGSAP);

MOTION = {
  dur:  { fast: 0.24, base: 0.42, slow: 0.72 },
  ease: { out: 'power3.out', inOut: 'power2.inOut', soft: 'expo.out' },
}
```

| Interaction | Where | Budget |
| --- | --- | --- |
| Featured-title entrance on Discover | `components/media/FeaturedHero.tsx` | One timeline: backdrop fade + 2 text lines + action row. ≤ 0.9 s total, transforms and opacity only. |
| Poster reveal | `components/media/PosterGrid.tsx` | Single stagger over the first screenful; `ScrollTrigger` batch for later rows, 0.18 s each, `overwrite: 'auto'`. Never more than a viewport's worth of elements in flight. |
| Nav active indicator | `components/app/AppShell.tsx` | 0.24 s slide on state change; the only persistent animated affordance. |
| Everything else (hover, focus, button press, row highlight, skeleton shimmer) | CSS transitions | ≤ 200 ms, no JS involvement. |

**Reduced motion is not a theme, it is a correctness requirement.** Three layers:

1. `prefersReducedMotion()` in `lib/gsap.ts` reads, in priority order: a per-device
   override stored in `document.documentElement.dataset.motion` (`reduce` / `allow`),
   then `matchMedia('(prefers-reduced-motion: reduce)')`.
2. Every timeline is created inside `gsap.matchMedia()` / a `useGSAP` scope, so when the
   preference flips the animation is reverted and the final state renders immediately.
3. `apps/web/src/styles/index.css` carries a `@media (prefers-reduced-motion: reduce)`
   block that zeroes CSS transitions and disables `tw-animate-css` entrances.

The Settings screen exposes the same switch as an explicit user control (System →
Motion), because a user who has motion sensitivity on one device may not have it set on
another. Mobile Safari's `prefers-reduced-motion` is honoured identically.

**ScrollTrigger caveat:** the blueprint warns against scroll hijacking. ScrollTrigger is
used *only* for `batch` reveals — it never pins, never `scrub`s, and never prevents
default wheel behaviour.

---

## 5. Player decision: Vidstack now, Video.js 10 documented as the successor

The blueprint allowed "Vidstack or another verified React player". What the research
found:

- **Vidstack 1.15.7** — MIT (verified in `node_modules`), typed React components,
  `<MediaPlayer>` with slots, source-type unions (`VideoMimeType` / `AudioMimeType`),
  `TextTrack` support for sidecar `.vtt`, controlled/uncontrolled `currentTime`, keyboard
  handling and focus management built in. It ships CSS themes as real stylesheet entry
  points (`@vidstack/react/player/styles/default/theme.css`).
- **Video.js 10** (`@videojs/react` v10.1.0, Apache-2.0) — Vidstack's own documentation
  points forward to it, and there is an official migration guide
  (`https://videojs.org/docs/guides/migrate-from-vidstack`). Its React package is new:
  a plugin-driven architecture with `npx @videojs/cli agents init --framework react`,
  presets (`video|audio|live-video|live-audio|background-video`), skins
  (`default|neutral|compat|scaffold|none`), and per-source adapters
  (`html5-video|hls|dash|mux-video|vimeo|youtube|cloudflare|tiktok|twitch`).

**Decision: ship Vidstack for the MVP, isolate it behind one component.**
`components/library/VaultPlayer.tsx` is the *only* file that imports the player library.
That is what the migration guide needs: one file, and the surrounding contract
(`{ item, startAtSeconds, onSaveProgress }`) does not change. Shipping Video.js 10 today
would mean betting the playback path of a brand-new app on the newest React binding of a
player mid-ecosystem-transition; the blueprint's acceptance criteria care about playback
working, subtitles loading, resume being accurate and errors being honest — all of which
Vidstack does today, at MIT, with types.

The reverse decision would also have been defensible; what would not be defensible is
pretending the trade-off doesn't exist. Both options and the migration path are recorded
here so the choice can be revisited without re-doing the research.

**Player contract in practice** (all verified against real files in this session):

- Only containers the player library can name are given a `type`
  (`mp4/m4v→video/mp4`, `webm`, `ogv→video/ogg`, `avi`, `mpg/mpeg/ts→video/mpeg`,
  `mp3→audio/mpeg`, `m4a→audio/mp3`, `flac`, `ogg`). Anything else is passed as a bare
  URL and the browser decides — an unknown extension is never dressed up as a supported
  format.
- Resume position comes from the server (`playback_progress`), not `localStorage`, so it
  survives a reinstall and works across devices on the same vault.
- A codec the browser cannot play produces a *stated* reason ("stored, playable in VLC"),
  never a silent black rectangle.

---

## 6. 21st.dev — used as reference, not as a source of code

21st.dev is a registry of community React components (12 000+ at the time of research).
Verified URLs that were actually loaded during research:

- `https://21st.dev/@minhxthanh/components/hover-preview`
- `https://21st.dev/@designali-in/components/vercel-hero`
- `https://21st.dev/@kokonutd/components/button-colorful`
- `https://21st.dev/@hammamikhairi/components/animated-gradient-background`
- `https://21st.dev/@muhammad-binsalman/components/rainbow-borders-button`
- `https://21st.dev/@aghasisakyan1/components/star-button`
- `https://21st.dev/@xubohuah/components/wave-background`
- `https://21st.dev/@kokonutd/components/background-paths`

**Every component on the site carries its own licence; there is no site-wide licence.**
Because of that, and because several of the most interesting entries (animated gradient
backgrounds, wave backgrounds, rainbow borders, star buttons) are precisely the kind of
decoration §3 excludes, **no 21st.dev code was copied into BlaxkVault.** The interaction
*ideas* that survived into this design — hover preview of a poster's metadata,
hero-with-backdrop entrance, a colourful primary button — were re-implemented from
scratch against our own tokens, so there is no attribution obligation and no unknown
licence in the tree. The URLs are listed above so the same reference material is one
click away for whoever continues the work.

---

## 7. ThreeUI — evaluated, deliberately not used

Three verified: `https://threeui.com` (with `/browse`), repository
`https://github.com/MengTo/threeui` (**MIT**, ~5.3k stars), npm `@designcodeio/threeui`
**v1.2.0 MIT**, peer dependencies React ≥18.2 and `three` ≥0.149. The free Community tier
exposes 50 parent components / 141 variants; the Pro CLI's source is unpublished, so the
free tier is what an open-source project could rely on.

It is not in the dependency tree. Reasons, in order of weight:

1. The blueprint's own non-goals exclude "gratuitous WebGL" and its MVP scope excludes
   heavy 3D. ThreeUI's value is in WebGL/three.js scenes, which is exactly that.
2. Adding `three` + a component layer to a local-first media app inflates the install and
   the bundle (the current production bundle is already ~1.1 MB of JS before gzip, most of
   it the player), for decoration no acceptance criterion asks for.
3. The most interesting free-tier components are hero/background scenes; §3 rules out
   ambient motion behind text.

It stays documented as an *optional* enhancement: if a "vault opening" hero is ever
wanted, `npm i @designcodeio/threeui` plus a subpath import
(`import { AtTheHorizon } from '@designcodeio/threeui/components/AtTheHorizon'`) and its
`style.css` is the whole integration, and it must degrade gracefully where WebGL is
unavailable.

---

## 8. Accessibility

- **Keyboard**: every interactive element is reachable and has a visible focus ring
  (`--ring`). `⌘K` / `Ctrl+K` opens the command palette; `/` focuses Discover search;
  `Space`/`K` play-pause in the player; `Esc` closes overlays. Skip-to-content link is the
  first focusable element in the shell.
- **Landmarks**: one `<header>`, one `<nav>`, one `<main>` per view; the poster grid is a
  list, not a soup of divs; status changes are announced through `aria-live="polite"` on
  the queue summary.
- **Contrast**: `--muted-foreground` on `--background` is ≥4.5:1 in both themes; status
  colours are paired with text labels ("Paused", "Failed") so colour is never the only
  signal.
- **Images**: poster `alt` text is `"<title> (<year>) poster"`; missing artwork renders a
  titled placeholder, never a broken image icon.
- **Reduced motion**: see §4.
- **Forms**: every input has a `<label>`; validation messages are inline and in text, and
  Zod errors from the server are surfaced verbatim rather than replaced with "error".

---

## 9. Performance budget

| Budget | Target | Current |
| --- | --- | --- |
| Initial JS (gzip) | < 400 KB | ~345 KB (`index-*.js`), player code split into its own chunk |
| Poster images | lazy, `decoding="async"` | `loading="lazy"` + explicit aspect-ratio boxes so nothing reflows |
| Animation frame cost | transform/opacity only | confirmed — no layout-triggering properties are animated |
| Long lists | never block the main thread | grid uses CSS `content-visibility: auto`; no virtualiser needed at current library sizes |
| Realtime traffic | coalesced | WebSocket progress events are flushed at most every 250 ms server-side |

---

## 10. Screen inventory (what §4/§5 of the blueprint asked for, and where it lives)

| Screen | File | Notable behaviour |
| --- | --- | --- |
| Discover | `pages/DiscoverPage.tsx` | Featured hero (GSAP entrance), debounced search, kind filters, real posters, infinite "load more", skeleton / empty / error-with-retry states, `/` shortcut to focus search. |
| Title detail | `pages/TitlePage.tsx` | Cinematic backdrop, poster, runtime/genres/cast, tabs for Overview · Where to watch · Downloads · Episodes, availability with source links, downloadability panel, honest "unavailable/unknown/unsupported" copy. |
| Series | `pages/TitlePage.tsx` | Season selector, episode rows with per-episode season/episode numbers, multi-select only over episodes that have a **real** permitted file. |
| Downloads | `pages/DownloadsPage.tsx` | Live queue (WebSocket), real bytes/speed/ETA, pause · resume · retry · cancel · remove-history, concurrency + bandwidth controls, durable across restart. |
| Library | `pages/LibraryPage.tsx` | Media-root diagnostics, search/filter, missing-file and unsupported-codec states, folder-layout reference, play → Watch. |
| Watch | `pages/WatchPage.tsx` | Vidstack player, subtitle tracks, resume, probe details, disk usage, recovery when the file vanished. |
| Sources | `pages/SourcesPage.tsx` | Adapter registry with capability badges and licence/attribution, direct-link inspector, Internet Archive search with rights badges, boundary statement. |
| Settings | `pages/SettingsPage.tsx` | Storage paths, queue limits, metadata credentials (presence only — secrets are edited server-side), theme, reduced motion, engine status. |

---

## 11. Open questions / risks carried forward

1. **TMDB key.** Without `TMDB_API_KEY` the app runs in a clearly-labelled offline sample
   catalogue (`mode: "fixture"` in `/api/health`). No metadata, poster, runtime or
   availability value is ever invented to cover the gap — the UI says which mode it is in.
2. **Vidstack → Video.js 10 migration** (§5): one component, no contract change, but it
   should be scheduled rather than discovered.
3. **Fonts.** Staying on the system stack is a deliberate trade: perfect offline
   behaviour and zero third-party requests, at the cost of a less distinctive display
   face. If a face is ever added it should be self-hosted and subset.
4. **Poster art licensing.** Posters come from the metadata provider's CDN; the app never
   re-hosts them. A self-hosted cache would change the terms, so it is not done.
