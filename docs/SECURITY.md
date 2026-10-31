# BlaxkVault — security model

> BlaxkVault downloads files from the internet onto a machine its owner controls. That is
> a genuinely dangerous thing for an app to do, so the security posture is written down
> rather than assumed. Every control below is implemented in code, and the ones that are
> testable have tests named after them.

---

## 1. Threat model

| # | Threat | Control |
| --- | --- | --- |
| T1 | A malicious URL makes the server fetch its own internal network or cloud metadata endpoints (SSRF). | `security/url-guard.ts` — deny-by-default address policy, DNS re-resolution, per-hop redirect validation, protocol/port/credential rules. |
| T2 | A crafted filename or path escapes the media root and writes anywhere on disk. | `security/paths.ts` — every derived path is sanitised and then proven to be inside an approved root before use. |
| T3 | The local API or the aria2 RPC is reachable by someone else on the network. | Loopback-trusted access control; refused start-up when exposed without a token; aria2 stays bound to `127.0.0.1` and is only ever called server-side. |
| T4 | An API key, RPC secret or access token leaks into the browser bundle, the git history or a log line. | Secrets live in `.env` (git-ignored), are read only in `config.ts`, are never serialised to a response, and URLs logged in full are redacted. |
| T5 | A media file is deleted when the user only meant to clear the download list. | History removal and file deletion are separate endpoints; file deletion requires `confirm=true`; a test asserts the file survives history removal. |
| T6 | Downloaded files are executed, or a "media" file turns out to be HTML/a script. | Downloads are written as data only; content type is checked at inspection; the stream endpoint sends `X-Content-Type-Options: nosniff` and a fixed content type; nothing from the media roots is ever served as HTML. |
| T7 | The app is used to obtain content the user has no right to. | Sources are limited to metadata providers and openly-licensed archives; rights are assessed before a file can be queued; DRM circumvention and paywall bypass are explicit non-goals, stated in the UI. |
| T8 | A slow or hostile server exhausts the app's resources. | Connect and idle timeouts, redirect cap, per-job size cap, concurrency cap, bandwidth cap, bounded body size (512 KB) on the API, and a bounded number of entries per library scan. |
| T9 | A remote page tricks the UI into doing something (clickjacking, injected script, exfiltrated data). | Strict CSP, `X-Content-Type-Options`, `Referrer-Policy: same-origin`, `frame-ancestors 'self'` by default, no `dangerouslySetInnerHTML` anywhere in the client, and no remote script/font/style origins. |
| T10 | An unexpected crash silently loses or corrupts queue state. | Progress is persisted on a throttle and flushed on shutdown; start-up reconciliation compares the database with the filesystem and prefers the filesystem. |

Out of scope (by design, not by omission): multi-user access control, protecting the media
from someone who already has filesystem access, and sandboxing the OS user the app runs
as. Run it as an unprivileged user with the permissions you want your library to have.

---

## 2. SSRF protection (`security/url-guard.ts`)

Every outbound fetch — inspection, download, redirect hop, probe — passes through
`assertSafeRemoteUrl()`.

**Shape rules, applied first:**

- Only `http:` and `https:`. Anything else (`file:`, `ftp:`, `data:`, `gopher:`, …) is
  refused before any I/O.
- URLs with embedded credentials (`https://user:pass@host/…`) are rejected.
- Ports allowed: 80, 443, or any port ≥ 1024. Privileged ports (22, 23, 25, 3306, 6379,
  11211, …) are refused, which blocks the "use the downloader as a port scanner" class of
  attack.

**Address rules:**

- A deny list of internal hostnames (`localhost`, `metadata.google.internal`, …) and
  internal suffixes (`.local`, `.internal`, `.lan`, `.home`, `.corp`, `.intranet`,
  `.onion`, …).
- Explicit metadata-service addresses (`169.254.169.254`, `169.254.170.2`,
  `100.100.100.200`, `fd00:ec2::254`).
- Numeric host forms are normalised before comparison, so
  `http://2130706433/`, `http://0177.0.0.1/` and `http://0x7f.0.0.1/` all resolve to
  `127.0.0.1` and all get blocked. (Verified live: `http://2130706433/x.mp4` returns
  `403 BLOCKED_ADDRESS`.)
- **Every** address a hostname resolves to is checked, not just the first — a DNS answer
  mixing a public and a private address is blocked outright (DNS rebinding defence).
- Unknown address shapes **fail closed**.
- `ALLOW_PRIVATE_ADDRESSES=false` is the default. Flipping it is a deliberate,
  documented act for local testing; even then, metadata addresses remain blocked.

**Redirects:** `safeFetch()` follows redirects manually (`redirect: 'manual'`) and
re-validates each hop with the same rules before requesting it, capped by
`MAX_REDIRECTS`. A public URL that 302s to `http://127.0.0.1/` never gets followed.

**Optional allowlist:** setting `ALLOWED_HTTP_HOSTS` restricts direct-URL fetches to those
hostnames only.

Timeouts are enforced with `AbortSignal` on every request (`CONNECT_TIMEOUT_MS`,
`IDLE_TIMEOUT_MS`); a stalled server is abandoned, never waited on indefinitely.

---

## 3. Filesystem safety (`security/paths.ts`)

Rules, in the order they are applied:

1. **Sanitise names.** `sanitizeFileName` / `sanitizeDirectoryName` strip control
   characters and every character that is illegal or dangerous on Windows or POSIX
   (`<>:"/\|?*`), collapse `..` sequences, trim dots/spaces, cap the length, and refuse
   reserved device names (`con`, `nul`, `com1`, …). A file that would be named `.` or `..`
   becomes a safe fallback.
2. **Resolve inside a root.** `resolveWithinRoot(root, relative)` joins, normalises
   (`path.resolve`), then proves containment with `path.relative` — not a string
   `startsWith`, which is defeated by `/media-evil` vs `/media`. Escapes raise
   `FORBIDDEN`.
3. **Restrict to approved roots.** `resolveInsideMediaRoots(absolute)` refuses any path
   outside the configured roots and returns which root it landed in, so callers cannot
   forget to check. The download directory is always one of the roots.
4. **Symlinks.** Library scanning and streaming resolve symlinks with `realpath` and skip
   anything that points outside its root (`assertNotSymlinkEscape`).
5. **No clobbering.** `uniqueFilePath` adds ` (1)`, ` (2)`… rather than overwriting, and a
   duplicate extension (`file.mp4.mp4`) is collapsed.
6. **Atomic writes.** Downloads go to `<file>.part` and are renamed only on success, so a
   partial transfer never looks like a finished file — including to the library scanner,
   which ignores `.part` outright.

The layout itself is derived, never user-supplied:
`Movies/<Title> (<Year>)/<file>` · `Series/<Title> (<Year>)/Season NN/<file>`,
with `classifyRelativePath` reading the kind back out of the path for the library index.

---

## 4. Access control (`security/auth.ts`)

Resolved once at start-up, before any route is registered:

| Situation | Mode | Behaviour |
| --- | --- | --- |
| Bound to loopback only | `loopback-only` | Requests from `127.0.0.1`/`::1` are trusted; anything else needs the token. |
| Bound beyond loopback **with** `BLAXKVAULT_ACCESS_TOKEN` | `token-required` | `Authorization: Bearer <token>` (or `?token=`) required, compared with `crypto.timingSafeEqual`. |
| Bound beyond loopback **without** a token | — | **Refuses to start.** An ephemeral token is generated, logged once as a warning, and the server starts in `token-required` mode. It never comes up silently open. |
| `BLAXKVAULT_ALLOW_UNAUTHENTICATED=true` | `open` | Every request is accepted, with a loud warning at every start. Documented for one narrow case: a sandbox/preview host that proxies to the app and is not reachable by untrusted clients. Never for a normal install. |

`GET /api/health` is the only public route; it reports version, uptime, capability flags
and access mode — and no paths, keys or configuration values.

**aria2 RPC.** The daemon is expected on `127.0.0.1` with `ARIA2_RPC_SECRET` set. The
server is its only client: the browser has no code path that can reach it, the endpoint is
never returned by the API, and the secret is never logged. Enabling aria2 is a settings
toggle, not a client-side URL.

---

## 5. Media streaming and subtitles

- `GET /api/library/stream?id=` resolves the item through the library index (not through
  a path the client supplies), re-validates that the file still exists and is inside its
  root, then streams with `Range` support so seeking works.
- Content type is taken from the probe result or the extension's known mapping — never
  sniffed from the client. Responses carry `nosniff`, and `Content-Disposition: inline`
  is only used for media, never for HTML.
- Subtitles are read through the same root check; a `..` in a subtitle path is refused
  exactly like any other traversal attempt.
- Missing files produce a `410`-style "file missing from disk" answer with the library's
  `missing` flag set, rather than a confusing 500.

---

## 6. Secrets

- All secrets live in `.env`, which `.gitignore` excludes; `.env.example` documents every
  variable with an empty value. No key is ever committed.
- `config.ts` is the only module that reads `process.env`. Nothing else touches it.
- The client bundle contains no secret: the API base URL is relative, and the web app has
  no provider keys, no RPC secret and no access token baked in.
- `GET /api/settings` returns **presence**, not values (`tmdbConfigured: true`), so the
  Settings screen can show "configured" without ever transmitting a key. Callers cannot
  read a key back out of the API — not even the one who set it.
- `logger.ts` redacts URLs before logging (`redactUrl` strips the query string, which is
  where signed tokens usually live) at every log level and in both output formats, so a
  token cannot be smuggled into a message string unnoticed. The one exception is
  deliberate and documented: the ephemeral access token, printed once when a server is
  exposed beyond loopback without one configured.
- Errors sent to the client are app-authored messages with stable codes. Stack traces are
  logged server-side and never returned over HTTP.

---

## 7. Third-party binaries

- **FFmpeg / FFprobe** — invoked through `spawn`/`spawnSync` with an **argument array**;
  a filename containing `;`, `` ` ``, `$(`, spaces or newlines is passed as one inert
  argument, never through a shell. There is no `shell: true` anywhere in the codebase.
  Probe output is parsed defensively and treated as untrusted input.
- **aria2** — JSON-RPC over loopback with a secret, method allowlist, and no `system.*`
  calls. The download directory is validated before a task is submitted.
- **Optional by design** — the app runs without either binary. Missing tooling produces a
  stated capability gap ("ffprobe not detected — duration and codec unknown"), never a
  fabricated value.

---

## 8. Rights, law and product boundaries

These are enforced in code, not just in copy:

1. **Metadata is not a file.** TMDB and Watchmode entries are never converted into a
   download target. The UI says so on the Sources screen and in every "unavailable"
   explanation.
2. **Rights are assessed before queueing.** Internet Archive items are checked for an open
   licence / public-domain collection before any file is offered. Items without a rights
   statement are listed but not queueable, and the reason is shown.
3. **The rights note travels with the job.** It is stored on the job row and displayed
   next to it — including after a restart.
4. **Direct URLs are the user's responsibility, and they say so.** Inspection records
   "user-supplied direct link — authorization confirmed by the operator" as the note.
5. **Not a piracy engine.** No torrent/magnet support, no DRM circumvention, no provider
   scraping, no paywall bypass, no stream ripping. The Sources screen states these limits
   in the product itself.
6. **Respect the source.** Bandwidth caps and concurrency limits exist partly so a source
   is never hammered, and the app identifies itself honestly in `User-Agent`.

---

## 9. Operational checklist

Before exposing BlaxkVault beyond `127.0.0.1`:

- [ ] Set `HOST=127.0.0.1` unless a container/reverse proxy genuinely requires `0.0.0.0`.
- [ ] Set `BLAXKVAULT_ACCESS_TOKEN` to a long random value (`openssl rand -hex 32`).
- [ ] Leave `BLAXKVAULT_ALLOW_UNAUTHENTICATED=false`.
- [ ] Leave `ALLOW_PRIVATE_ADDRESSES=false`.
- [ ] Leave `BLAXKVAULT_FRAME_ANCESTORS='self'` unless you are deliberately embedding the UI.
- [ ] Confirm the server did **not** print "Listening on … without BLAXKVAULT_ACCESS_TOKEN".
- [ ] Confirm `media` roots contain nothing you would not want indexed by the app.
- [ ] Terminate TLS at the proxy if the token crosses a network. The token is a bearer
      credential; the app itself speaks plain HTTP on loopback by design.
- [ ] Keep `.env` out of backups that are shared, and out of any screenshot of Settings.

## 10. Reporting

This is a self-hosted personal application with no server-side component you do not run
yourself, so there is no vendor to report to — there is you. If you find a weakness in
these controls, fix it in your checkout, and if you publish the fix, please keep the threats
in §1 in mind so a mitigation for one does not remove another.
