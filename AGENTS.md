# Heiba — agent notes

Private video streaming platform. Monorepo: pnpm workspaces, Node 24, TS 5.9.

## Gates (run before committing)

- `pnpm run build` — typechecks every package, then builds
- `pnpm test` — Vitest suites (api-server); currently 11 files / 105 tests
- Codegen check: `pnpm --filter @workspace/api-spec run codegen` must be deterministic (no diff afterwards)

## Non-obvious conventions

- `lib/api-spec/openapi.yaml` is the API source of truth. After editing it, run codegen. Never hand-edit `lib/api-zod/src/generated/` or `lib/api-client-react/src/generated/`.
- Orval's zod output collides on `UploadVideoFileBody` (zod + types both export it); `lib/api-spec/fix-zod-index.mjs` rewrites the zod barrel after codegen and is wired into the codegen script.
- `pnpm-workspace.yaml` is a pnpm v11 lockfile config file: only `packages`, `catalog`, and `ignoredBuiltDependencies` belong there. Add new deps via the catalog, reference with `"pkg": "catalog:"`.
- Videos are private by default. Visibility is derived: APPROVED + shares a group with the member. `src/lib/video-library.ts` holds the shared helpers (memberGroupIds, getVideoOr404, serializeVideo).
- Upload race: busboy `finish` fires when parsing completes, not when the async storage write finishes — the upload promise must only settle on storage success/failure (see `src/lib/uploads.ts`).
- Storage default dir is `storage` (files land at `storage/videos/<id>/<uuid>.<ext>`); do not reintroduce `storage/videos` as the default.
- Storage providers: local (default) and R2 (S3-compatible, `VIDEO_STORAGE_PROVIDER=r2` + `R2_*`). Direct browser uploads go through presigned URLs tracked in `video_uploads`; local provider intentionally reports `directUploadSupported=false` and the SPA falls back to the proxy upload. Never bypass the `VideoStorage` interface from business logic.
- URL import: `src/lib/import.ts` provider registry. Direct http(s) file URLs actually download into storage; YouTube/socials are recognised stubs that never fetch. Import failures must delete the partial storage object.
- Frontend talks to `/api` same-origin. Dev: Vite proxies to the API server. Prod: API server serves `WEB_DIST` with SPA fallback.
- orval v8 generated hooks require `queryKey` in `query` overrides — always pass `get<Op>QueryKey(...)` alongside `enabled`/`retry` overrides.
- Dev DB seeded users: owner@heiba.local (OWNER), member@heiba.local (MEMBER, in group "Alpha Team").

## Dev server smoke

API: `PORT=3000 pnpm --filter @workspace/api-server run dev`. Web: `pnpm --filter @workspace/web run dev`. Full-stack prod check: `WEB_DIST=$PWD/artifacts/web/dist PORT=<port> node artifacts/api-server/dist/index.mjs`.
