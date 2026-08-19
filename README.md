# Heiba

Private video streaming platform: an owner-managed library where videos are
uploaded, manually reviewed, and streamed only to authorized group members.
No public sharing, no registration — access is by invitation only.

## Feature matrix

| Area | Behaviour |
| --- | --- |
| Accounts | Admin-created only. Roles: OWNER, ADMIN, GROUP_MANAGER, MEMBER |
| Sessions | Cookie or `Authorization: Bearer`; scoped revoke (own session, all sessions, admin kill switch) |
| Security | bcrypt-hashed passwords, login rate limiting, constant-time token compare, Zod validation everywhere |
| Videos | Admin CRUD; video files stored via a `VideoStorage` provider (local disk, pluggable) |
| Review | Every uploaded file lands in `PENDING_REVIEW`; an admin must approve (or reject with notes) before members can see it. Re-upload re-enters review. Full audit history per video |
| Access | Videos are private by default; sharing is group-based (`video_groups`). Members see and stream only approved videos shared with a group they belong to |
| Library | Member-facing browse with search, category/group filters, pagination |
| Streaming | `GET /api/stream/:id` with HTTP `Range` support (`206 Partial Content`) for seeking |
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

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm run build` | Typecheck all packages, then build |
| `pnpm run typecheck` | Typecheck only |
| `pnpm test` | Workspace test suites (Vitest) |
| `pnpm --filter @workspace/api-spec run codegen` | Regenerate `api-zod` + `api-client-react` from `lib/api-spec/openapi.yaml` |
| `pnpm --filter @workspace/db run push` | Push Drizzle schema to dev DB |

## API surface

`lib/api-spec/openapi.yaml` is the contract source of truth; the React client
and Zod validators are generated from it with Orval.

- `POST /api/auth/login` · `POST /api/auth/logout[/all]` · `GET /api/auth/me` · `GET/DELETE /api/auth/sessions[/:id]`
- `GET/POST /api/admin/users` · `PATCH/POST/DELETE /api/admin/users/:id[/sessions/:sid]` (owner/admin)
- `GET/POST /api/groups` · `GET/PATCH/DELETE /api/groups/:id` · members: `GET/POST/PATCH/DELETE /api/groups/:id/members[/:userId]`
- `GET/POST /api/categories` · `PATCH/DELETE /api/categories/:id`
- `GET/POST /api/videos` · `GET/PATCH/DELETE /api/videos/:id` · `POST /api/videos/:id/file` (multipart)
- `GET /api/reviews/pending` · `POST /api/videos/:id/review` · `GET /api/videos/:id/reviews`
- `GET /api/library/videos[/:id]` (member-scoped) · `GET /api/stream/:id` (Range-aware)

## Layout

- `artifacts/api-server` — Express API (routes → `src/routes/`, upload handling in `src/lib/uploads.ts`, storage providers in `src/lib/storage/`)
- `artifacts/web` — Production frontend (Vite + React + wouter + React Query + Tailwind v4)
- `artifacts/mockup-sandbox` — UI mockup sandbox (not the product frontend)
- `lib/db` — Drizzle schema + migrations
- `lib/api-spec` — OpenAPI spec + Orval config + `fix-zod-index.mjs` post-codegen repair
- `lib/api-zod`, `lib/api-client-react` — generated clients (do not hand-edit `src/generated/`)
