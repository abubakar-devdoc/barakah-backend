# Barakah Backend (Core MVP)

Production-oriented Node.js + Express + TypeScript (ESM) API for the Barakah Quran Khawani & Collective Ibadah platform.

Express is the **primary authorization boundary**. PostgreSQL Row Level Security (RLS) is defense-in-depth via a restricted `barakah_app` role and per-request `set_config` identity.

## Stack

- Node.js 20+, Express, TypeScript ESM
- PostgreSQL via `pg` (Supabase-compatible)
- Custom auth: bcrypt passwords, short-lived JWT access tokens, rotating opaque hashed refresh tokens (HttpOnly cookie)
- Helmet, strict CORS, rate limiting, compression, request IDs, pino
- Zod validation, centralized errors, health/readiness, graceful shutdown
- Socket.io (authorized campaign rooms)
- Cron reconciliation (stats, auto-complete, outbox, expired sessions)
- OpenAPI / Swagger at `/docs`

## Quick start

```bash
cd backend
cp .env.example .env
# edit DATABASE_URL, JWT_ACCESS_SECRET, CORS_ORIGINS
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

API base: `http://localhost:4000/api/v1`  
Swagger: `http://localhost:4000/docs`  
Health: `GET /health` · Ready: `GET /ready`

## Database migrations

SQL lives in `supabase/migrations/` (ordered):

1. Extensions + helpers (`set_updated_at`, `app_*` helpers)
2. Organizations, users, memberships
3. Auth sessions + password reset OTPs
4. Campaigns, members, Quran assignments/segments/progress, Dhikr, `campaign_stats`
5. Notifications, audit, activity, outbox
6. Views + functions (`v_campaign_progress`, recompute/complete/dhikr batch)
7. RLS policies (FORCE RLS)
8. `barakah_app` role provisioning

Apply with Supabase CLI or `psql` as a privileged migration role (not the app role).

Example (`psql`):

```bash
# from backend/
psql "$DATABASE_URL" -f supabase/migrations/20260717000001_init_extensions_and_helpers.sql
# …apply 002 through 008 in order
```

### Bootstrap first super admin

After migrations and `barakah_app` password setup:

```bash
# Use a privileged DB URL for bootstrap only
BOOTSTRAP_SUPER_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_SUPER_ADMIN_PASSWORD='StrongPass123!' \
BOOTSTRAP_SUPER_ADMIN_NAME='Barakah Admin' \
DATABASE_URL='postgresql://postgres:YOUR_ROTATED_PASSWORD@HOST:5432/postgres' \
npm run bootstrap:super-admin
```

Then run the API with the restricted `barakah_app` connection string.

### Role provisioning (required)

Application connections **must** use `barakah_app` (no `BYPASSRLS`, not table owner).

After migrations:

```sql
ALTER ROLE barakah_app PASSWORD 'choose-a-strong-password';
-- Optional: grant CONNECT on database
GRANT CONNECT ON DATABASE postgres TO barakah_app;
```

Then set:

```env
DATABASE_URL=postgresql://barakah_app:URL_ENCODED_PASSWORD@HOST:5432/postgres
```

**Never** point the API at the `postgres` superuser for runtime queries.

### Request-scoped RLS identity

Every repository call that mutates/reads tenant data goes through `withTransaction()` in `src/db/pool.ts`, which runs:

```sql
BEGIN;
SELECT set_config('app.user_id', $1, true);
SELECT set_config('app.org_id', $2, true);
SELECT set_config('app.platform_role', $3, true);
SELECT set_config('app.org_role', $4, true);
-- queries --
COMMIT;
```

`true` = local to the transaction (safe with pooled connections).

## Auth model

- **No public signup.** Admins create users (`POST /api/v1/users`) with a temporary password and `must_change_password=true`.
- Roles:
  - Platform: `super_admin` | `user`
  - Organization: `org_owner` | `org_admin` | `member`
- Login issues a short-lived access JWT + refresh cookie (`barakah_refresh`).
- Refresh rotates the opaque token; reuse of a revoked token revokes the entire family.
- Send `Authorization: Bearer <access>` and optionally `X-Organization-Id` for org-scoped admin actions.

## Core API surface

| Area | Endpoints |
|------|-----------|
| Auth | `POST /auth/login`, `/refresh`, `/logout`, `/change-password`, `GET /auth/me` |
| Users | Admin CRUD under `/users` |
| Orgs | `/organizations`, memberships |
| Campaigns | CRUD, lifecycle, members |
| Assignments | Deterministic Juz distribute, manual assign, start/complete/admin skip |
| Progress | `GET /campaigns/:id/progress` |
| Dhikr | `GET .../dhikr`, `POST .../dhikr/batch` (idempotent) |

Response envelope:

```json
{ "success": true, "data": { } }
```

```json
{ "success": false, "error": { "code": "...", "message": "..." }, "requestId": "..." }
```

## Socket.io

Connect with access token in `handshake.auth.token`.  
Join rooms via `campaign:join` `{ campaignId }` after membership check.  
Server emits campaign events from outbox / completion paths.

## Security notes

- Do not commit real credentials. Rotate any secrets previously shared in chat.
- Custom auth is **not** Supabase Auth; do not expose app tables via PostgREST `anon`/`authenticated`.
- Refresh tokens are stored hashed (SHA-256) only.

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | tsx watch server |
| `npm run build` | compile to `dist/` |
| `npm start` | run compiled server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit + light integration |

## Folder structure

```text
backend/
  src/
    config/ controllers/ routes/ middleware/
    services/ repositories/ models/
    utils/ validators/ cron/ socket/
    db/ openapi/
  supabase/migrations/
  uploads/ logs/
  tests/
```

## Environment-dependent verification

After configuring a real Postgres + `barakah_app`:

1. Apply migrations
2. Bootstrap a super admin (insert user with bcrypt hash, `platform_role='super_admin'`)
3. `GET /ready` → success
4. Login → create org → create Quran campaign → distribute Juz → complete assignments → campaign auto-completes
5. Create Dhikr campaign → submit duplicate `clientBatchId` → count applied once
