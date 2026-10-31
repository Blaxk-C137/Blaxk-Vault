# BlaxkVault

**Discover. Download. Watch. Keep.**

A self-hosted vault for films and series: search a real catalogue, download media you are
allowed to download, and keep a tidy, playable offline library. One Node process, one
SQLite file, one browser tab.

BlaxkVault is deliberately *not* a piracy tool. It reads metadata from real catalogues,
finds files only where an open licence or your own authorization permits it, and tells you
the truth when it cannot get something — including the reason.

---

## What it does

| Screen | What actually happens |
| --- | --- |
| **Discover** | Debounced search over a real metadata catalogue, real posters/backdrops/years/genres/synopses, trending rows, responsive grid, keyboard support (`/` focuses search, `⌘K` opens the palette), honest loading/empty/error states. |
| **Title detail** | Cinematic backdrop, cast, genres, runtime, and *separate* indicators for "where you can stream it" versus "what you can actually download". Opening the Downloads tab runs the check automatically. If a matching file is already in your library, the page says so and offers to play it instead of re-downloading. Every verdict explains itself: available, unavailable, unsupported, or unknown. |
| **Series** | Season selector, episode metadata, per-episode check for a genuinely permitted file, and multi-select queueing — only ever over episodes that really exist as files. |
| **Downloads** | A durable queue with real bytes, real speed and real ETA. Pause, resume, retry, cancel, remove history (the file stays), plus configurable concurrency and bandwidth. Survives a restart by reconciling the database against what is on disk. |
| **Library** | A predictable folder layout, search and filters, sidecar subtitles, remembered playback position, and accurate messages when a file is missing or its codec cannot play in a browser. |
| **Sources** | The adapter registry with capability badges, licences and attribution, a direct-link inspector (SSRF-guarded), and Internet Archive search with rights badges. |
| **Settings** | Storage paths, queue limits, metadata regions, download engine, theme, reduced motion, tool detection. Credentials are configured server-side and only ever reported as "configured". |

---

## Quick start

```bash
git clone <your-fork> blaxkvault && cd blaxkvault
npm install
cp .env.example .env      # optional: add TMDB_API_KEY for the live catalogue
npm run build
npm start                 # http://127.0.0.1:3000
```

The template is safe to copy verbatim: comments sit on their own lines, and the loader
also understands inline `#` comments, quoted values and `export ` prefixes if you write
them yourself. Values containing `#` (a URL fragment, a hex colour) are preserved — a
comment only starts at a `#` that follows whitespace.

For development with hot reload:

```bash
npm run dev               # API on :3000
npm run dev:web           # Vite on :5173, proxying /api and /ws
```

**Quiet by default.** `npm run dev` prints one line when it is ready and nothing else
until something actually happens:

```
07:25:50  info  BlaxkVault ready  url=http://127.0.0.1:3000/  mode=development  catalogue="sample (no TMDB_API_KEY)"  engine=native  tools=none (sizes only)  library="1 file"  media=./media/BlaxkVault-Media
```

| You want | Do this |
| --- | --- |
| Readable lines (default in development) | nothing — `LOG_FORMAT` is `pretty` automatically |
| JSON for a log collector | `LOG_FORMAT=json` (default when production output is piped) |
| To see startup detail, DB paths, tool detection, every scan | `LOG_LEVEL=debug` |
| A completely silent watch loop | `LOG_LEVEL=warn` (or `silent`) |

Development also binds to `127.0.0.1` by default, so there is no access-token dance
while coding — set `HOST=0.0.0.0` when you deliberately expose it, and it will tell you
(in two short lines) what token to use.

**Requirements:** Node 20 or newer. Nothing else is mandatory — `ffprobe`/`ffmpeg` are
detected and used when present, and an `aria2c` daemon is optional. Without `ffprobe` the
app still downloads, indexes and plays; it simply reports duration and codec as unknown
instead of guessing.

---

## Configuration

Everything lives in `.env` (see `.env.example` for the annotated template). The
essentials:

| Variable | Default | Notes |
| --- | --- | --- |
| `HOST` / `PORT` | `127.0.0.1` in development, `0.0.0.0` in production / `3000` | Commented out in the template so the default applies; set it to override. |
| `BLAXKVAULT_ACCESS_TOKEN` | empty | Required if bound beyond loopback; the server generates a temporary one and warns rather than starting open. |
| `DOWNLOAD_DIR` | `./media/BlaxkVault-Media` | Where downloads land, in the documented layout. |
| `MEDIA_ROOTS` | empty | Extra folders to index read-only. Empty means "just the download directory". |
| `TMDB_API_KEY` | empty | Without it, Discover runs in a **clearly labelled** offline sample mode. |
| `WATCHMODE_API_KEY` | empty | Enables where-to-watch listings for your region. |
| `DOWNLOAD_ENGINE` | `native` | `aria2` forwards to a loopback JSON-RPC daemon instead. |
| `MAX_CONCURRENT_DOWNLOADS` / `BANDWIDTH_LIMIT_KBPS` / `MAX_DOWNLOAD_BYTES` | `2` / `0` / `0` | `0` means unlimited; all three are editable in the app. |
| `ALLOW_PRIVATE_ADDRESSES` | `false` | Keep it off — it is the SSRF guard. |

---

## Scripts

| Command | Does |
| --- | --- |
| `npm run build` | Builds shared → web → server. |
| `npm start` | Runs the API and serves the built client from one port. |
| `npm run dev` / `npm run dev:web` | Watch-mode API / Vite dev server. |
| `npm run typecheck` | Type-checks all three packages. |
| `npm test` | Unit + engine tests (Vitest). |
| `npm run smoke` | End-to-end check against a running server, including a real download. |

`npm test` and `npm run smoke` leave nothing behind: the smoke test downloads a real
file, verifies it, then removes its own artifact, so a verification run never grows the
working tree. Downloaded media lives in `media/` and is git-ignored — keep that folder
out of backups and snapshots if you sync this directory.

Library scans are covered by their own suite (`apps/server/tests/library.test.ts`): a
second scan over unchanged files must report no churn, and changing which folder is a
media root must re-key the entry — keeping its id and resume position — rather than
reporting "one file removed, one file added".

---

## Verified behaviour

These are results from this repository, not aspirations:

- **82 tests pass** (66 server, 16 client). The engine suite downloads from a local
  fixture server and asserts: real end-to-end transfer, pause keeping the partial file, resume
  continuing from the right byte, cancel removing it, a genuine failure recorded with its
  reason, concurrency limits (including raising the cap live), restart reconciliation,
  size caps, and that removing history never deletes media.
- **`npm run smoke` passes 16/16 checks** against a live server: health and capability
  reporting, the WebSocket snapshot, a real Internet Archive search, SSRF refusals
  (`127.0.0.1`, `169.254.169.254`, `http://2130706433/`), rights gating (items without an
  open licence are not offered), inspection, a **real 27.3 MB download** with progress
  observed over the WebSocket, the finished file appearing in the library index, no
  leftover `.part`, and history removal leaving the file in place.
- **The SSRF guard is exercised live**, not just in unit tests: loopback, cloud-metadata
  and integer-encoded addresses are all refused with `403 BLOCKED_ADDRESS`.
- **The client is rendered, not just compiled.** `apps/web/tests` mounts the real
  component tree against a stubbed API and asserts what a user sees — Discover renders
  catalogue data, a failing provider produces a readable error instead of a blank page,
  the settings screen reports a missing `ffprobe` honestly, and an unknown route really
  renders the 404 screen.

---

## Project layout

```
blaxkvault/
├── apps/
│   ├── server/          Fastify API, adapters, download engine, library service
│   │   ├── src/{routes,engine,adapters,services,security,db}
│   │   ├── tests/       url-guard · paths · archive-rights · engine
│   │   └── scripts/     smoke.ts — the end-to-end check
│   └── web/             React 19 + Vite + Tailwind v4 client
│       └── src/{pages,components,api,store,hooks,lib,styles}
├── packages/shared/     Types, Zod schemas, status maps and formatters
├── docs/
│   ├── UI_RESEARCH.md   Component sources, licences, motion rules, player decision
│   ├── ARCHITECTURE.md  Process model, data model, API, engine, testing
│   └── SECURITY.md      Threat model and every implemented control
└── .env.example
```

---

## How it decides what you can download

Four states, and the fourth one matters most:

- **available** — a real, permitted file was found and inspected. You get a queue button,
  with the rights note displayed beside it.
- **unavailable** — nothing was found. The app says where it looked and reminds you that a
  catalogue entry is not a file.
- **unsupported** — something exists that this build cannot fetch or play (DRM, protocol,
  container). The reason is stated precisely.
- **unknown** — not checked, no API key, or the provider was unreachable. The app says so
  and offers a re-check. It never upgrades a guess to a green tick.

Sources today: **TMDB** (metadata and artwork, never a file), **Watchmode** (where-to-watch
listings), **Internet Archive** (public-domain / openly-licensed items only, rights checked
before queueing), and **direct URLs you supply**, inspected server-side before they are
accepted.

### What "downloadable" can and cannot mean

BlaxkVault will not make a commercial film downloadable. TMDB is a metadata database — it
hosts no video — and the only sources for a current release are paywalled or
rights-restricted. Pointing the app at those would mean fabricating links or wiring in
piracy sources, which is the one thing this project exists not to do. That is a boundary,
not a bug to be fixed.

What it does instead, so that as much as possible is genuinely available:

| Situation | What you get |
| --- | --- |
| The work is public domain or openly licensed (most pre-1930 cinema, Blender films, and thousands of Archive uploads) | A real, rights-checked file with its size, format and licence note. `npx tsx apps/server/scripts/measure-open-sources.ts` currently reports **30/30** open titles resolved. |
| You already own a copy | The title page shows "Play your copy" — matched server-side on the title's distinctive words plus the year, so it never opens the wrong film. |
| You have an authorised direct link | Paste it into the inspector. It is fetched server-side, SSRF-guarded, and queued with your rights note attached. |
| It exists only on a commercial service | The app says so, links you to where-to-watch, and explains why it will not fetch it. |

Measured honestly: 30/30 open titles found; the sample catalogue is 10/10 because every
title in it is a public-domain film. A modern blockbuster will read "No permitted file
found" — and that is the correct answer.

---

## Security in one paragraph

The API is loopback-trusted, uses a bearer token when exposed, and refuses to start open
on a network. Every outbound request — including each redirect hop — is validated against
an SSRF denylist that covers private, loopback, link-local, reserved and cloud-metadata
addresses, plus decimal/octal/integer encodings of them. Filenames are sanitised and every
derived path is proven to be inside an approved media root. FFmpeg is only ever invoked
with an argument array. API keys live in `.env`, are never sent to the browser and are only
reported as "configured". The aria2 RPC stays on `127.0.0.1` and is never exposed to the
client. Full detail — including the threat table and the pre-exposure checklist — is in
[`docs/SECURITY.md`](docs/SECURITY.md).

---

## Legal

BlaxkVault is a personal media organiser. It is built to work with content you are
entitled to download: public-domain works, openly-licensed media, and files you provide
yourself. It contains no ability to bypass DRM, paywalls or provider protections, and
those are explicit non-goals rather than missing features. You are responsible for what
you download and for keeping the rights information with the file. Rights notes are stored
on each job and shown beside it so that obligation is easy to honour.

## Licence notes

BlaxkVault's own code is yours to use as you like; the third-party pieces carry their own
terms, recorded in [`docs/UI_RESEARCH.md`](docs/UI_RESEARCH.md). One deserves highlighting:
**GSAP is used under the GreenSock Standard "No Charge" licence, which is not MIT** — free
for this use, but worth reading before commercial redistribution. Everything else in the
stack is MIT, Apache-2.0 or ISC.

## Known limitations

- The player is Vidstack today; its ecosystem's successor is Video.js 10. The player is
  isolated in a single component and the migration path is documented (UI_RESEARCH §5).
- Without `ffprobe`, technical detail (duration, codec, resolution) is reported as unknown.
- `.ts` means MPEG transport stream to BlaxkVault, so pointing a media root at a source
  tree will index TypeScript files as video. Point roots at folders that hold media —
  a scan of 2,000+ files takes a couple of seconds, and it will tell you how many it
  added.
- No torrent/magnet support, no multi-user accounts, no mobile native app — all by design.
