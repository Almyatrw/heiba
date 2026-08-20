# Heiba

Private video streaming platform: an owner-managed library where videos are
uploaded or imported from direct file URLs, manually reviewed, and streamed
only to authorized group members. No public sharing, no registration — access
is by invitation only. The interface is Arabic-first (RTL) and fully usable in
English.

## Feature matrix

| Area | Behaviour |
| --- | --- |
| Accounts | Admin-created only. Roles: `OWNER`, `ADMIN`, `GROUP_MANAGER`, `MEMBER` |
| Sessions | Cookie or `Authorization: Bearer`; scoped revoke (own session, all sessions, admin kill switch) |
| Security | Argon2id-hashed passwords, login rate limiting, constant-time token compare, Zod validation everywhere |
| Videos | Admin CRUD; video binaries live behind a `VideoStorageProvider` abstraction — never in PostgreSQL |
| Upload | Local dev: server-mediated streaming upload. Production R2: direct browser-to-storage presigned uploads (single PUT or multipart) with progress, part retries, abort, and job tracking + stale-upload cleanup |
| Import | Direct video file URLs (mp4/webm/mkv/mov) are actually downloaded into storage and enter the same review lifecycle. YouTube is disabled by default; X, Facebook, Instagram, LinkedIn and TikTok are recognised stubs, never downloaded |
| Review | Every uploaded/imported file lands in `PENDING_REVIEW`; an admin must approve (or reject with notes) before members can see it. Re-upload re-enters review. Full audit history per video. No automatic moderation |
| Access | Videos are private by default; sharing is group-based (`video_groups`). Members see and stream only approved videos shared with a group they belong to |
| Library | Member-facing browse with search, category/group filters, pagination |
| Streaming | `GET /api/stream/:id` with HTTP `Range` support (`206 Partial Content`) for seeking. Objects stay private; playback is authorized per request |
| Deactivation | Deactivating a user revokes all their sessions immediately |

## Quickstart

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL
pnpm --filter @workspace/db run push        # apply schema to dev DB
pnpm run build                              # typecheck + build everything

# Development (two terminals):
pnpm --filter @workspace/api-server run dev # API on :5000
pnpm --filter @workspace/web run dev        # Vite on :5173, proxies /api → :5000

# Production (single process serves API + frontend):
WEB_DIST=$PWD/artifacts/web/dist PORT=5000 node artifacts/api-server/dist/index.mjs
```

Bootstrap the first owner account via `OWNER_EMAIL` / `OWNER_PASSWORD` env vars
(created once at startup if absent).

## URL import providers

`POST /api/videos/:id/import` accepts three kinds of URLs, each handled by its
own provider behind the `VideoImportProvider` interface (new providers plug in
without touching the pipeline):

| Source | Enable flag | Extra requirements |
| --- | --- | --- |
| Direct video file URLs (mp4/webm/mkv/mov) | always on | — |
| X/Twitter post URLs | `HEIBA_ENABLE_X_IMPORT=true` | `yt-dlp` + `ffmpeg` on the server; X blocks guest extraction from datacenter IPs, so production needs `HEIBA_X_COOKIES_FILE=/path/to/x-cookies.txt` (Netscape cookies.txt exported from a logged-in X session; read by the importer process only, never logged or stored) |
| YouTube URLs | `HEIBA_ENABLE_YOUTUBE_IMPORT=true` | `yt-dlp` + `ffmpeg` (ffmpeg merges split DASH video+audio into one mp4) |

All imports run in the background (HTTP 202) and converge on the same
pipeline as file uploads: the video is `PROCESSING` while downloading, lands
in `PENDING_REVIEW` on success, or `FAILED` with the reason persisted in
`storage_meta` and surfaced in the UI. Import fetches refuse URLs resolving
to private/reserved network ranges (SSRF guard); set
`HEIBA_IMPORT_ALLOW_PRIVATE_NET=true` only in trusted private networks.

## Object storage (R2)

Binaries are always behind the [`VideoStorage`](artifacts/api-server/src/lib/storage/index.ts)
interface. Two providers ship:

- **Local** (default dev) — filesystem under `VIDEO_STORAGE_DIR`.
- **Cloudflare R2** (production, S3-compatible) — [`r2.ts`](artifacts/api-server/src/lib/storage/r2.ts).
  Enable with `VIDEO_STORAGE_PROVIDER=r2` plus `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (see
  [`.env.example`](.env.example)). Credentials never reach the browser:
  uploads use short-lived presigned URLs, playback is authorized per request
  through the API, and objects are never public.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm run build` | Typecheck all packages, then build |
| `pnpm run typecheck` | Typecheck only |
| `pnpm test` | Workspace test suites (Vitest) |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate `api-zod` + `api-client-react` from [`openapi.yaml`](lib/api-spec/openapi.yaml) |
| `pnpm --filter @workspace/db run push` | Push Drizzle schema to dev DB |

## API surface

[`lib/api-spec/openapi.yaml`](lib/api-spec/openapi.yaml) is the contract
source of truth; the React client and Zod validators are generated from it
with Orval.

- `POST /api/auth/login` · `POST /api/auth/logout[/all]` · `GET /api/auth/me` · `GET/DELETE /api/auth/sessions[/:id]`
- `GET/POST /api/admin/users` · `PATCH/POST/DELETE /api/admin/users/:id[/sessions/:sid]` (owner/admin)
- `GET/POST /api/groups` · `GET/PATCH/DELETE /api/groups/:id` · members: `GET/POST/PATCH/DELETE /api/groups/:id/members[/:userId]`
- `GET/POST /api/categories` · `PATCH/DELETE /api/categories/:id`
- `GET/POST /api/videos` · `GET/PATCH/DELETE /api/videos/:id` · `POST /api/videos/:id/file` (multipart, dev)
- `POST /api/videos/:id/import` — async background import (202). Sources: direct video file URLs, X/Twitter post URLs and YouTube URLs (each gated by a server flag). `GET /api/videos/:id/import-status` reports QUEUED/PROCESSING/COMPLETED/FAILED plus the failure detail.
- `GET /api/videos/:id/upload-capabilities` · `POST /api/videos/:id/direct-upload` · `POST /api/videos/:id/direct-upload/:uploadId/complete|abort` (presigned uploads)
- `GET /api/reviews/pending` · `POST /api/videos/:id/review` · `GET /api/videos/:id/reviews`
- `GET /api/library/videos[/:id]` (member-scoped) · `GET /api/stream/:id` (Range-aware)

## Layout

- [`artifacts/api-server`](artifacts/api-server) — Express API (routes → `src/routes/`, upload handling in `src/lib/uploads.ts`, import providers in `src/lib/import.ts`, storage providers in `src/lib/storage/`)
- [`artifacts/web`](artifacts/web) — Production frontend (Vite + React + wouter + React Query + Tailwind v4); Arabic-first i18n in `src/lib/i18n.tsx`
- [`artifacts/mockup-sandbox`](artifacts/mockup-sandbox) — UI mockup sandbox (not the product frontend)
- [`lib/db`](lib/db) — Drizzle schema + migrations
- [`lib/api-spec`](lib/api-spec) — OpenAPI spec + Orval config + `fix-zod-index.mjs` post-codegen repair
- [`lib/api-zod`](lib/api-zod), [`lib/api-client-react`](lib/api-client-react) — generated clients (do not hand-edit `src/generated/`)
