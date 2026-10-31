# BlaxkVault — architecture

> Local-first. One Node process, one SQLite file, one browser client. No Redis, no
> message queue, no microservices, no cloud dependency — the blueprint rules those out
> for the MVP, and every decision below is made to keep that true.

---

## 1. Process model

```
┌───────────────────────────── Browser (apps/web) ─────────────────────────────┐
│  React 19 + Vite 8 · TanStack Query · GSAP · Vidstack · Tailwind v4          │
│  Talks to exactly one origin: its own. Nothing in the bundle holds a secret. │
└───────────────┬──────────────────────────────────────────┬───────────────────┘
                │ fetch /api/* (JSON)                      │ WebSocket /ws
                │ Range requests for /api/library/stream   │ (jobs, stats, notices)
┌───────────────▼──────────────────────────────────────────▼───────────────────┐
│                     Node 20 + Fastify 5 (apps/server)                        │
│                                                                              │
│  routes/  health · discovery · sources · downloads · library · settings      │
│  engine/  inspect → probe → native-downloader | aria2  → manager (queue)     │
│  adapters/  tmdb · watchmode · archive · direct-url   (source registry)      │
│  services/  settings · library (scan, probe, subtitles, progress)            │
│  security/  url-guard (SSRF) · paths (traversal) · auth (access control)     │
│  db/       Drizzle schema over better-sqlite3                                │
└───────┬─────────────────────────┬────────────────────────┬───────────────────┘
        │                         │                        │
   data/blaxkvault.db        media roots            127.0.0.1:6800
   (settings, jobs,            (indexed + written)   aria2 JSON-RPC (opt-in)
    library, progress,                                ── never exposed to
    inspections)                                         the browser
```

Everything is same-origin on purpose. The client never constructs a URL to the network,
never contacts a metadata provider directly, and never learns the RPC secret — it asks
this server, and this server decides.

### Boot order (`apps/server/src/index.ts`)

1. Load and validate configuration: `lib/env-file.ts` parses `.env` (inline comments,
   quotes, `export ` prefixes, values containing `=`), then `config.ts` validates the
   result with Zod. Real environment variables always win over the file.
2. Open SQLite, run migrations, report the table count.
3. Resolve access control *before* any route exists (`initAccessControl()`); refuse to
   start exposed without a token.
4. Construct the download manager with persisted limits and **reconcile** the queue
   against reality on disk (see §5).
5. Register routes, attach the realtime hub, serve the built client in production.
6. Detect `ffprobe` / `ffmpeg` availability once, report it in the startup line, and never
   pretend they exist.
7. Kick off a first library scan in the background (non-blocking).
8. Install SIGINT/SIGTERM handlers that pause live work and close cleanly.

---

## 2. Packages

| Package | Purpose | Notes |
| --- | --- | --- |
| `packages/shared` | One source of truth for types, Zod request schemas, status/label maps and byte/time formatters. | Consumed by the server at runtime (built to `dist`) and by the web app at build time (aliased to source by Vite). A change to a status name or an API shape is a compile error on both sides. |
| `apps/server` | Fastify API, adapters, download engine, library service, realtime hub. | Node ESM, `tsc` build to `dist`, `tsx` for dev. |
| `apps/web` | The single-page client. | Vite dev server proxies `/api` and `/ws` to the backend, so the browser still sees one origin. In production Fastify serves `apps/web/dist`. |

Root scripts: `dev`, `dev:web`, `build`, `start`, `typecheck`, `test`, `smoke`, `build:shared`.

**Toolchain note (known wrinkle).** The web workspace type-checks with TypeScript 7 while
the server and shared workspaces use TypeScript 5.9, and both test suites run on Vitest 2
with the web's own Vite 8 nested under it. That combination is deliberate for now —
`vitest@5` (the version whose peer range covers Vite 8) could not be resolved through the
package registry available while this was built, and swapping either half blindly breaks
one of the two suites. The fix when the registry allows it: move all three workspaces to
one TypeScript and one Vitest major in a single commit, then re-run `npm test` and
`npm run smoke`. `apps/web/vitest.config.ts` is intentionally excluded from `tsc` for the
same reason (two Vite type copies in one graph), and is proven by running the suite.

---

## 3. Data model (SQLite + Drizzle)

Five tables; deliberately no more.

| Table | Holds | Why it is not "just in memory" |
| --- | --- | --- |
| `settings` | Key/value overrides for paths, limits, theme, regions, engine. | The vault must behave the same after a restart. |
| `jobs` | One row per download: status, engine, urls, paths, bytes, speed, ETA, rights note, attempts, validators (`etag`, `last_modified`, `accept_ranges`), aria2 GID, timestamps. | This is the durable queue. It is the difference between "a progress bar" and "a download manager". |
| `library_items` | Indexed media: root, relative path, kind, size, parse of title/year/season/episode, probe JSON, subtitle tracks, `missing` flag. | Library state survives restarts and detects files that vanished outside the app. |
| `playback_progress` | Position, duration, completed flag per library item. | Resume works across devices and reinstalls. |
| `inspections` | Cached inspection result per URL hash. | Stops the same URL being probed repeatedly; 15-minute TTL keeps it honest. |

Indexes exist on `jobs.status`, `jobs.created_at`, `library_items.relative_path` and
`library_items.missing` — the four columns the UI actually filters by.

A library row is identified by `(root, relative_path)`, but the file it describes is
identified by its **absolute path**. Those differ whenever the media-root list changes
(a root added or removed, `DOWNLOAD_DIR` moved, the vault folder nested under an existing
collection), so the scan matches on the absolute path first and re-keys the row — keeping
its id, its playback position and the date it was added. Otherwise a root change looks
like "one file removed, one file added", which is how an earlier build silently reset
resume positions and left ghost entries behind. `dedupeByAbsolutePath()` cleans up rows
that an older scan already duplicated.

---

## 4. Source adapters

Every source is an adapter behind one interface, so the UI can render a source card with
its capability badges without knowing anything provider-specific.

| Adapter | Capabilities | What it will and will not do |
| --- | --- | --- |
| `tmdb` | `metadata` | Metadata, artwork URLs, credits, seasons/episodes, where-to-watch links. **Never a file** — TMDB hosts no video. Disabled without `TMDB_API_KEY`. |
| `watchmode` | `availability` | Streaming availability listings per region, with deep links. Disabled without `WATCHMODE_API_KEY`. |
| `internet-archive` | `metadata`, `authorized-download` | Public-domain / openly-licensed items only. Rights are assessed from the item's `licenseurl`/collection before a file may be queued; items without a rights statement are shown but never queueable. |
| `direct-url` | `authorized-download` | A user-supplied HTTP(S) media URL after full server-side inspection. The user confirms authorization, and that confirmation is recorded on the job as its `rightsNote`. |

`GET /api/sources` returns each adapter's id, label, capabilities, homepage, attribution
text and current enablement — the Sources screen is a rendering of that response, not a
hardcoded list.

### The downloadability model

Downloadability is a **four-state** verdict, and the fourth state is the important one:

| Status | Meaning | UI behaviour |
| --- | --- | --- |
| `available` | A real, permitted file was found and inspected. | Queue button, with the rights note shown next to it. |
| `unavailable` | Nothing was found. | Explain where it was looked for, and that a metadata record is not a file. |
| `unsupported` | Something was found that this build cannot fetch or play. | Explain exactly what (DRM, protocol, container) and what would be needed. |
| `unknown` | Not checked, no API key, provider unreachable. | Say so, offer a re-check. **Never "available".** |

"Unknown" is a first-class state in the type system (`DOWNLOADABILITY_STATES`), which is
what stops the UI from accidentally rendering an untested guess as a green tick.

---

## 5. Download engine

Two interchangeable engines behind `engine/manager.ts`:

- **native** (default) — a Node HTTP(S) worker: `Range` resume, `If-Range` validators,
  connect/idle timeouts, redirect following through the SSRF guard, bandwidth cap by
  token bucket, `.part` file + atomic rename on completion.
- **aria2** (opt-in) — the same jobs forwarded to a localhost `aria2c` JSON-RPC daemon
  with a secret. The browser never sees that endpoint; the server is the only client.

### State machine

```
inspected ─▶ queued ─▶ downloading ─▶ completed
                 │           │
                 │           ├─▶ paused ──▶ (resume) ─▶ downloading
                 │           ├─▶ failed ──▶ (retry)  ─▶ queued
                 │           └─▶ cancelled
                 └─▶ unsupported / unavailable
```

Terminal states: `completed`, `failed`, `cancelled`, `unsupported`, `unavailable`.
`remove` (history only) is refused while a job is downloading; deleting the **file**
requires an explicit `confirm=true` and is a different endpoint entirely. Removing history
never deletes media — there is a test named exactly that.

### Durability and reconciliation

On start-up, `manager.init()` reads every non-terminal row and compares it with the
filesystem:

- a `.part` file exists → the job becomes `paused` with `bytesDownloaded` set to the
  **actual size on disk**, so a resume is real and progress is never inflated;
- the destination file already exists at full size → the job becomes `completed`;
- neither exists → the job becomes `paused` at 0 with a note, ready to retry.

Cancelling deletes the partial file (there is a regression test for the leak this used to
have); pausing keeps it. Progress is written on a throttle, not on every chunk, and
`flush()` runs before shutdown so a clean stop never loses position.

### Realtime

One WebSocket at `/ws`. The hub sends `jobs.snapshot` + `stats` on connect, then
coalesces `job.updated` bursts to at most one flush per 250 ms. Events: `jobs.snapshot`,
`job.updated`, `job.removed`, `notice`, `stats`. Clients can send `{type:'resync'}` to get
a fresh snapshot instead of replaying deltas. The socket carries no secrets and no paths
the client could not already fetch over REST.

---

## 5a. Logging and what a normal startup looks like

`logger.ts` writes one line per event in one of two shapes, chosen automatically:
`pretty` for a human (default in development, and in any terminal), `json` for a log
collector (default in production when output is piped). `LOG_FORMAT` forces either.

Startup is deliberately defensive about noise. Details that repeat on every boot
(database path, media directory, engine choice, ffprobe/ffmpeg detection, a scan that
found nothing) are `debug`. What remains at `info` is the one line an operator needs:

```
07:25:50  info  BlaxkVault ready  url=http://127.0.0.1:3000/  mode=development  catalogue="sample (no TMDB_API_KEY)"  engine=native  tools="ffprobe,ffmpeg"  library="12 files"  media=./media/BlaxkVault-Media
```

A library scan only speaks up when the library actually moved (`Library changed  added=1
removed=0`); a clean scan is `debug`. Warnings stay warnings: an exhausted disk, an
unreachable provider, a blocked address, or a server exposed without a token.

`LOG_LEVEL=debug` restores every detail when something is wrong; `LOG_LEVEL=warn` gives
a silent watch loop. Secrets never appear at any level — URLs are redacted before they
are logged, and the only token ever printed is the one-time ephemeral access token the
operator cannot obtain otherwise.

## 6. API surface

Everything is under `/api`. All request bodies and query strings are Zod-validated
before a handler runs; all errors come back as `{ error: { code, message, hint? } }` with
a stable machine code.

| Method & path | Purpose |
| --- | --- |
| `GET /api/health` | Status, version, uptime, capability flags (tmdb, watchmode, archive, aria2, ffprobe, ffmpeg, database), mode (`live`/`fixture`), access-control mode. |
| `GET /api/search?q=&kind=&page=` | Debounced catalogue search (TMDB, or the labelled offline sample set). |
| `GET /api/trending?kind=&window=` | Featured/trending rows for Discover. |
| `GET /api/titles/:id` | Full title detail (metadata, cast, crew, genres, runtime). |
| `GET /api/titles/:id/seasons` | Season list for a series. |
| `GET /api/titles/:id/season/:season` | Episode list for one season. |
| `GET /api/titles/:id/availability?region=` | Where-to-watch listings with provider links. |
| `GET /api/titles/:id/local-copies` | Files already in this library that match the title (bidirectional title agreement + year), so the UI can offer Play instead of a duplicate download. |
| `GET /api/titles/:id/downloadability` | Four-state verdict + candidate files with sizes, mime types, rights notes. |
| `POST /api/titles/episodes/downloadability` | The same check, batched over selected episodes. |
| `GET /api/sources` | Adapter registry with capabilities, attribution, enablement. |
| `POST /api/sources/inspect` | Inspect one URL (SSRF-guarded) → verdict, headers, probe, codec note. |
| `GET /api/archive/search?q=` / `GET /api/archive/items/:id` | Internet Archive search and item detail, with rights assessment. |
| `GET /api/downloads` / `POST /api/downloads` | Queue + create (creates an `inspected` job, then `queued`). |
| `GET /api/downloads/:id` | One job. |
| `POST /api/downloads/:id/{pause,resume,cancel,retry}` | Lifecycle. |
| `DELETE /api/downloads/:id` | Remove history — **file kept**. |
| `DELETE /api/downloads/:id/file?confirm=true` | Explicit, confirmed file deletion. |
| `GET /api/library?q=&kind=` / `POST /api/library/scan` | Index and search the media roots; force a rescan. |
| `GET /api/library/stats` | Counts, total size, roots, disk usage. |
| `GET /api/library/stream?id=` | Range-aware media streaming with `Content-Type` from the probe; used by the player. |
| `GET /api/library/subtitles?path=` | Sidecar subtitle file, resolved **inside** a media root. |
| `GET|POST /api/library/items/:id/progress` | Resume position. |
| `GET|PATCH /api/settings` | Read/patch settings (paths, limits, regions, engine, theme, motion). Credential *values* are never returned. |
| `GET /api/stats` | Server-side counters for the shell's status pill. |

---

## 7. Client architecture

- **Routing** — `react-router-dom` with a single `AppShell` layout; Discover is `/`,
  plus `/title/:id`, `/downloads`, `/library`, `/watch/:id`, `/sources`, `/settings`,
  and a real 404. Reloading any deep link works because the server falls back to
  `index.html` for non-API paths.
- **Server state** — TanStack Query only. Query keys are centralised, mutations
  invalidate precisely (`invalidateQueries` per key), and the WebSocket writes straight
  into the cache so the queue is live without polling.
- **Client state** — one small Zustand store (`store/ui.ts`) for things the server has no
  opinion about: sidebar collapsed, palette open, per-device motion override.
- **Errors** — a top-level error boundary plus per-view error states that show the
  server's real message and a retry. "Something went wrong" is never the only message.
- **Theming** — `<html>` gets `dark`/`light` and `data-motion="reduce|allow"`. Server
  settings are adopted only when the device has no explicit local choice.
- **Player** — isolated in `components/library/VaultPlayer.tsx` (see UI_RESEARCH §5).

---

## 8. Testing strategy

| Layer | Tool | What is covered |
| --- | --- | --- |
| Library scan | Vitest | Idempotent scans (no churn on unchanged files), re-keying when the media-root list changes while preserving item id, playback position and added date, and healing of duplicate rows left behind by an earlier root change. |
| Security units | Vitest | `url-guard` (23 cases: IPv4/IPv6 ranges, decimal/octal/integer encodings, metadata hostnames, protocol and port rules, redirect re-validation), `paths` (15: traversal, reserved names, extension stripping, layout classification), archive rights (11). |
| Engine | Vitest + a local HTTP fixture server | Real end-to-end download to disk, pause/resume keeping the partial file, cancel removing it, a genuine failure recorded with its reason, concurrency limits (including raising the cap at runtime), restart reconciliation, size caps, and "removing history never deletes media". |
| Client render | Vitest + jsdom + Testing Library | The real component tree mounted against a stubbed API: Discover renders catalogue data, a provider failure renders a readable error rather than a blank screen, Settings reports absent tooling honestly, an unknown route renders the 404 view. Catches the class of bug a typecheck cannot — a component that throws on first paint. |
| Live smoke | `npm run smoke` | Also proves the harness is self-cleaning: the downloaded file is deleted at the end of the run, so verifying the app never leaves tens of megabytes in the working tree. |
| Live smoke | `npm run smoke` | Against a running server: health/capabilities, WebSocket snapshot, real Internet Archive search, SSRF refusals, selection of a genuinely permitted file, inspection, a real download with observed progress over the socket, library indexing, no leftover `.part`, and history removal leaving the file intact. |

There is also a measurement tool rather than a test for open-source coverage —
`apps/server/scripts/measure-open-sources.ts` reports how many real public-domain and
openly-licensed titles the matcher can satisfy, and it is run after any change to the
matcher. It reports misses instead of hiding them.

Two habits worth keeping: the fixture server is only ever used to test *the code's own
logic* (never to fake a real download), and the smoke test refuses to fall back to a
smaller/unsupported file to make itself pass — it reports the real smallest permitted size
instead.

---

## 9. Deliberate omissions (and what they would cost)

| Not built | Why | What it would take |
| --- | --- | --- |
| Redis/BullMQ queue | One process, one user; SQLite is the durable queue. | A queue service, a second failure mode, deployment surface. |
| Microservices | Same. | Nothing the blueprint asks for needs it. |
| Multi-tenancy / Kubernetes | Out of scope by the blueprint. | Auth provider, per-tenant storage, orchestration. |
| Metadata scraping of streaming sites | Would be a rights violation and a maintenance treadmill. | Don't. |
| DRM circumvention | Illegal and explicitly a non-goal. | Don't. |
| Heavy 3D / WebGL hero | Excluded by the blueprint; bundle cost for decoration (see UI_RESEARCH §7). | `@designcodeio/threeui` + `three`, lazy-loaded, with a non-WebGL fallback. |
| Torrent / magnet handling | Would make the app a general piracy engine. | Out of scope by design. |

---

## 10. Deployment

```bash
npm install                 # workspace install
cp .env.example .env        # fill in what you have; everything is optional except paths
npm run build               # shared → web → server
npm start                   # Fastify serves the API and the built client on one port
```

- Default binding is `0.0.0.0:3000` for container/preview use; a desktop install should
  set `HOST=127.0.0.1`.
- Binding beyond loopback without `BLAXKVAULT_ACCESS_TOKEN` generates an ephemeral token
  and logs it once — the server refuses to be silently open on a network.
- Media roots default to the download directory. Point `MEDIA_ROOTS` at an existing
  collection to index it read-only; overlapping roots are de-duplicated so one file never
  becomes two library entries.
- `ffprobe` and `ffmpeg` are optional. Without them the app still downloads, still
  indexes and still streams; it simply reports what it cannot measure instead of
  inventing duration or codec values.
