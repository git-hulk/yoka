# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo shape

Two-tier app for tracking burndown of prepaid packages (yoga classes, coaching hours, etc.). The Rust server lives at the repo root; the UI lives in `web/`.

- Repo root — the Rust backend (axum + sqlx + SQLite): `Cargo.toml`, `src/`, `tests/`, `migrations/`. Binary name `yoka`, library crate `yoka`.
- `web/` — React 18 + Vite + TypeScript + Tailwind, talks to the backend over `/api`.

## Commands

### One-server deploy (repo root)

```bash
make build           # web/dist (built with base /web/) + release binary
make run             # build the UI, then cargo run — everything on :3000
```

The server mounts `web/dist` at `/web` when it exists (`WEB_DIST` overrides the path, default `web/dist` relative to the server's cwd), with an index.html fallback for SPA deep links; `/` redirects there. The API answers both on bare paths (dev proxy, tests) and under `/api` (the built UI's same-origin fetches).

### Backend (repo root)

```bash
cargo run                    # serve on 127.0.0.1:3000; auto-creates ./yoka.db
cargo test                   # unit (in-crate) + integration (tests/api.rs)
cargo test <name>            # single test, e.g. cargo test done_when_remaining_zero
cargo test --test api        # only the integration suite
cargo clippy --all-targets   # lint
cargo fmt                    # format
```

Config: `config.yaml` at the repo root (optional; path movable via `YOKA_CONFIG`) sets `port` (host stays 127.0.0.1) and `data_dir` (directory for `yoka.db`, created at boot). Unknown keys are boot errors. Env vars override the file entirely: `DATABASE_URL` (default `sqlite://yoka.db?mode=rwc`), `BIND_ADDR` (default `127.0.0.1:3000`), `RUST_LOG` (default `yoka=debug,tower_http=info,info`). Resolution lives in `src/config.rs`.

### Frontend (`cd web`)

```bash
npm run dev          # vite on :5173, proxies /api → 127.0.0.1:3000
npm run build        # tsc -b && vite build
npm run typecheck    # tsc -b --noEmit
```

The dev proxy strips the `/api` prefix before forwarding, so `fetch("/api/packages")` hits `GET /packages` on the Rust server. For production builds, set `VITE_API_BASE` at build time (defaults to same-origin `/api`).

## Architecture

### Backend layering (strict, top-down only)

```
http  →  domain  →  db   (HTTP handlers call domain + db; domain calls nothing)
       └─ schema (wire types)
```

- **`http/`** — handlers are deliberately thin: extract args, validate, call `db` + `domain::lifecycle`, return a `schema::` wire type. No SQL, no business rules.
- **`domain/lifecycle.rs`** — pure functions, no async, no I/O. `derive(quantity, usages, start_date, expires_at, now)` produces `consumed/remaining/days_until_expiry/required_pace_per_day/status`. Status priority: `Done` > `Expired` > `NotStart` > `Active`. All status/pace fields are recomputed on read, never persisted. Callers pass `now` so the same code answers "what does this look like next Monday".
- **`db/`** — owns the `SqlitePool`. Each function returns either a row struct (private to the module) or a domain-shaped value. No HTTP types here. The two read paths for usages are intentional: `amounts_for_pace[_many]` is the narrow projection feeding `lifecycle::derive`; `list` returns full rows for the API.
- **`schema/`** — wire types only. Kept separate from db rows (storage can evolve) and domain types (domain stays HTTP-agnostic). `snake_case` throughout so JS reads it directly with no rename pass.
- **`error.rs`** — single `AppError` enum implements `IntoResponse`. Handlers return `Result<T, AppError>` everywhere. Server errors get logged at `error`; client errors at `debug`. The response body is `{"error": "<stable_code>"}` so the frontend can switch on `code`, not parse text.

### Migrations

Hand-rolled, not `sqlx::migrate!`. Each migration is `include_str!`'d into the `MIGRATIONS` slice in `lib.rs` and tracked by SQLite's `PRAGMA user_version` (the 1-based index of the last applied migration). To add one: write the `.sql`, append to the slice in order — version is positional. No down-migrations.

SQLite specifics worth knowing:
- All tables `STRICT` (type-checked, no silent coercion).
- Booleans stored as `INTEGER 0/1`. Amounts/quantities as `REAL` (fractional units supported).
- Timestamps as ISO-8601 UTC `TEXT`; date-only fields (`start_date`, `expires_at`) as `YYYY-MM-DD`.
- Foreign keys enforced per-connection — `db::connect` turns them on. WAL + `synchronous = NORMAL` for concurrent reads.
- `usages.package_id` FK is `ON DELETE RESTRICT` — packages with usages must be archived, not deleted.

### Time-known lock

`packages.time_known` is a boolean meaning "amounts represent time (hours) rather than count". The `PATCH /packages/:id` handler refuses to flip it once any usage exists (`AppError::BadRequest("time_known_locked")`), because changing it would silently re-interpret historical amounts.

### Integration tests

`tests/api.rs` runs handlers against `sqlite::memory:` with `max_connections(1)` (each connection to `:memory:` is a separate DB, so the pool must be pinned to one to share state across handler calls). Use the `setup()` / `insert_package()` / `insert_usage()` helpers; route requests through `router(state).oneshot(...)` from `tower::util::ServiceExt`.

### Frontend structure

- `src/lib/api.ts` — typed fetch client. Errors throw `ApiError { status, code }`; the `code` matches the backend's stable error code.
- `src/lib/types.ts` — hand-mirrored copy of `schema/packages.rs`. No codegen; update both sides together when wire types change.
- `src/lib/useFetch.ts` — tiny `react-query` replacement. Returns a discriminated `{ status: "loading" | "ok" | "error" }`. Pages `switch` on `state.status` rather than juggling `data`/`loading`/`error`.
- `src/pages/` — route components (`Home`, `PackageDetail`, `PackageEdit`, `PackageNew`). Three of four are lazy-loaded in `App.tsx`.
- `src/components/` — reusable UI (`PackageCard`, `PackageForm`, `StatusPill`, `TrackBand`, `UsageEditor`, `Sidebar`).
- `src/components/ui/` — the control primitives (`Button`/`ButtonLink`/`buttonClass`, `Input` + form-control classes, `ToastProvider`/`useToast`). All buttons and form controls go through these; don't restate their class strings inline.

### Frontend design tokens

The UI system follows Linear's design language (light theme, cool green-tinted neutrals, crisp hairlines, compact controls) — full spec in `DESIGN.md`. `tailwind.config.js` defines the tokens: `pace.{green,amber,red}` for burndown status, `ink.{DEFAULT,dim,faint}` for text, `canvas`/`surface`/`subtle`/`hairline` for layering, `accent` (+ `accent-deep` hover, `accent-soft` wash) for the brand action, and `shadow-{page,pop,modal}` for depth. Stick to these tokens — don't introduce ad-hoc hex codes. One font family only: Inter. Radii: `rounded-md` (6px) on controls, `rounded-lg` (8px) on containers/popovers/modals. No italics anywhere.
