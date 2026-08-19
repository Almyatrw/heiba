# Heiba

Private, scalable video streaming platform: an owner-managed library where videos are uploaded or imported, manually reviewed, and streamed only to authorized group members.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000, or `$PORT`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (see `.env.example`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/api-server` — Express API (`src/index.ts` entry → `src/app.ts` → `src/routes/`), health endpoint at `/api/healthz`
- `lib/api-spec/openapi.yaml` — source of truth for API contracts; Orval config in `orval.config.ts`
- `lib/api-zod` — generated Zod schemas (`src/generated/`), consumed by the server for response validation
- `lib/api-client-react` — generated React Query hooks + `src/custom-fetch.ts` mutator (generic `customFetch<T>`, exports `ErrorType`)
- `lib/db` — Drizzle schema (`src/schema/`: users, groups, user_groups, videos, sessions) + `drizzle.config.ts`
- `artifacts/mockup-sandbox` — Vite/React sandbox for UI mockups
- Full product spec: `attached_assets/Pasted-Build-a-Scalable-Private-Video-Streaming-Platform-1-Pro_1787005027314.txt`

## Architecture decisions

- Phase 0 DB scope is the core identity/content skeleton: users, groups, user_groups (M2M membership), videos (metadata only — no binaries in DB), sessions (token hashes, never raw tokens). Remaining spec entities (categories, reviews, watch progress, jobs, audit logs, monetization placeholders) land in later phases.
- `user_role` enum covers all spec roles (OWNER/ADMIN/GROUP_MANAGER/MEMBER); `video_status` covers the full lifecycle incl. PRIVATE/ARCHIVED/FAILED. No automatic moderation statuses — every new video enters PENDING_REVIEW after PROCESSING.
- bigint columns use `{ mode: "number" }` (safe up to 2^53, keeps IDs JSON-friendly).
- API contracts are defined once in OpenAPI and codegen'd to both server-side Zod validators and client React Query hooks — never hand-write either side.

## Product

Phase 0 (current): workspace scaffold, health endpoint validated by generated Zod schema, core DB schema verified against live Postgres. No user-facing features yet.

## User preferences

- Do not push to remote unless explicitly asked.
- Work in phases; fully verify each phase (typecheck, build, codegen, DB push, server smoke) before starting the next.

## Gotchas

- pnpm 11 writes an `allowBuilds` placeholder into `pnpm-workspace.yaml` when a build script is ignored; keep `allowBuilds: { esbuild: true }` set or nested installs (e.g. codegen's dep check) fail.
- drizzle-orm 0.45 requires `{ mode }` on `bigint`/`bigserial` and named index builders (`index("name").on(col)`); table extra config uses the array form.
- `mockup-sandbox` vite config requires `PORT`/`BASE_PATH` only for `vite dev`/`preview`, not for `vite build`.
- `lib/db/src/index.ts` throws at import time if `DATABASE_URL` is unset.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
