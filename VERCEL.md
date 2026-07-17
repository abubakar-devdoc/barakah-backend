# Deploying Barakah backend on Vercel

This Express API can run on Vercel as a **serverless function**. Realtime Socket.io is disabled; the frontend polls instead. Cron runs via Vercel Cron.

## 1. Project settings

- Root directory: `backend` (or this repo if already split)
- Build command: `npm run build` (already in `vercel.json`)
- Framework: Other

## 2. Environment variables (Vercel → Settings → Environment Variables)

Copy from local `.env`, then set production values:

| Variable | Notes |
|----------|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Supabase **pooler** URL for `barakah_app` (prefer transaction pooler / port 6543) |
| `DATABASE_SSL` | `true` |
| `DATABASE_POOL_MAX` | `3` |
| `JWT_ACCESS_SECRET` | 32+ chars |
| `CORS_ORIGINS` | Your frontend URL, e.g. `https://barakah-frontend.vercel.app` |
| `REFRESH_COOKIE_SECURE` | `true` |
| `REFRESH_COOKIE_SAME_SITE` | `none` (required for cross-site cookies frontend↔backend) |
| `REFRESH_COOKIE_PATH` | `/api/v1/auth` |
| `CRON_SECRET` | Long random string (Vercel Cron uses it as Bearer token) |
| `CRON_ENABLED` | `false` (platform cron is used instead) |
| `SWAGGER_ENABLED` | `false` in production (optional) |

## 3. Frontend (separate Vercel project)

Set:

```
VITE_API_URL=https://YOUR-BACKEND.vercel.app/api/v1
VITE_ENABLE_SOCKETS=false
```

Do **not** set `VITE_SOCKET_URL` for the Vercel API.

## 4. Smoke test

- `GET https://YOUR-BACKEND.vercel.app/health`
- `GET https://YOUR-BACKEND.vercel.app/ready`
- Login from the frontend

## Limits

- No Socket.io (polling every ~8s on campaign detail)
- Cold starts possible
- Keep DB pool small
