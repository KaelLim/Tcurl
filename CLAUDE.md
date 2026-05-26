# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Reference

```bash
# Development (auto-reload on file changes)
deno task dev

# Production
deno task start

# Type check
deno task check

# Lint & Format
deno task lint
deno task fmt

# Run tests
deno task test
```

## Architecture Overview

**TCurl** is a short URL service for Tzu Chi Foundation, built with:
- **Runtime**: Deno 2.x
- **Framework**: Hono (not Fastify - migrated from Node.js)
- **Database**: Supabase (PostgreSQL + Auth)
- **Cache**: Nginx (no Redis - Nginx handles all caching)
- **Frontend**: Vanilla JS + TailwindCSS + QRCodeStyling

### Critical: Supabase Dual-Client Pattern

The project uses TWO Supabase clients for different scenarios:

```typescript
// 1. Service Client (bypasses RLS) - for system operations
import { supabase } from './services/supabase.js'
// Use for: short URL redirects, click tracking, public queries

// 2. User Client (respects RLS) - for authenticated user operations
const userClient = createUserClient(accessToken)
// Use for: all CRUD operations that should be scoped to the user
```

**Rule**: Any API that needs user authentication MUST use `createUserClient(token)` to let Supabase RLS handle permissions automatically.

### Request Flow

```
User Request
    ↓
Nginx (SSL, caching for /s/* routes)
    ↓
├── Cache HIT → Direct response (ClickWatcher records via log)
└── Cache MISS/EXPIRED → Deno backend
    ↓
Hono (src/main.ts)
    ↓
├── Static files: /public/*
├── Short URL redirect: /s/:code → Supabase → record click
├── API routes: /api/* → src/routes/url-crud.ts, url-stats.ts, auth.ts
└── Auth: Supabase JWT validation
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Hono app entry, middleware (CSP, CORS, logging), static serving |
| `src/routes/url-crud.ts` | URL CRUD, QR code, password verification |
| `src/routes/url-redirect.ts` | Short URL redirect, ad pages |
| `src/routes/url-stats.ts` | Statistics queries via RPC (get_url_stats, get_urls_with_stats, etc.) |
| `src/routes/url-pages.ts` | HTML page routes (/links, /edit, /analytics, /feedback, /docs, /admin) |
| `src/routes/auth.ts` | User auth (/api/auth/me, /api/auth/profile) |
| `src/routes/_helpers.ts` | Shared route utilities (getUserClientFromRequest, sendUnauthorized) |
| `src/routes/feedbacks.ts` | Community feedback/suggestion routes |
| `src/routes/admin.ts` | Admin dashboard API (stats, all URLs/users/feedbacks, ADMIN_EMAILS auth) |
| `src/services/supabase.ts` | Supabase clients (service + user factory) |
| `src/services/click-log-watcher.ts` | Monitors Nginx logs and records cache HIT clicks (incl. channel_id) |
| `src/routes/url-channels.ts` | Channel CRUD (UTM tracking, multi QR code per URL) |
| `src/utils/asset-version.ts` | Reads version from deno.json, injects `?v=` into HTML asset refs |
| `src/utils/html-templates.ts` | Password prompt, expired, ad interstitial pages |
| `public/js/auth.js` | Frontend Supabase auth (Keycloak OIDC) |

## Database Schema

**Main tables**:
- `urls` - short URLs with `qr_code_options` (JSONB), `password_hash`, `expires_at`
- `url_clicks` - click tracking with `event_type` ('link_click', 'qr_scan', 'ad_view', 'ad_click') and optional `channel_id`
- `url_channels` - UTM channel tracking per URL (`group_key`, `name`, `utm_source/medium/campaign/content/term`)

**RPC functions** (SECURITY DEFINER, used by `url-stats.ts`):
- `get_url_stats(p_url_id, p_days)` - single URL stats with daily + channel breakdown
- `get_urls_with_stats(p_user_id, p_page, p_limit)` - paginated URL list with aggregated stats
- `get_stats_summary(p_user_id)` - totalLinks, activeLinks, totalClicks
- `get_daily_stats(p_user_id, p_days)` - daily trend across all user URLs

## Code Conventions

- **Formatting**: 2-space indent, single quotes, 100-char line width (configured in `deno.json`)
- **Imports**: Use `.ts` extension in import paths (e.g., `import { urlRoutes } from './routes/urls.ts'`)
- **Lint scope**: Only `src/main.ts`, `src/routes/`, `src/services/`, `src/utils/` are linted; `public/js/` and `src/types/` are excluded
- **Tests**: Place test files as `*_test.ts` in `src/` or in the `tests/` directory

## Known Gotchas

### 1. Column Name: `qr_code_options` (plural)
The database column is `qr_code_options` (with 's'). Using `qr_code_option` (singular) will cause 500 errors.

### 2. QRCodeStyling Live Preview
Use **Canvas mode**, not SVG. SVG has caching issues with `update()`:
```javascript
const config = { type: "canvas", ... }  // NOT "svg"
```

### 3. Browser Caching API Responses
Add cache busters for critical data:
```javascript
fetch(`/api/urls/${id}?_=${Date.now()}`, { cache: 'no-store' })
```

### 4. CSP for External Resources
When adding new external resources, update CSP in `src/main.ts`:
- `imgSrc` - for images
- `styleSrc` - for CSS
- `scriptSrc` - for JS
- `connectSrc` - for fetch/XHR targets

### 5. Nginx Caching
Only `/s/*` routes are cached by Nginx. API and HTML pages bypass Nginx cache. Static assets (JS/CSS) bypass Nginx proxy cache but allow browser caching.

### 6. Frontend api.js: Backend API vs Direct Supabase
`public/js/api.js` uses two patterns — don't mix them up:
- **Backend API** (`fetch('/api/...')` with Bearer token): `getUrls`, `getUrlStats`, `getStatsSummary`, `updateUrl`, all channel methods — these use server-side RPC for performance
- **Direct Supabase** (`this.getClient()`): `createUrl`, `getUrl`, `deleteUrl`, `updateQRCode` — these use the Supabase JS client with RLS

## Cache Strategy

### Short URL Redirect Cache (Nginx)
- **Nginx caches 301/302 redirects** for `/s/*` routes (5 min TTL)
- **Cache key**: `shorturl$request_uri` (includes query params like `?g=xxx&qr=1`)
- **Click tracking**: ClickWatcher monitors Nginx logs for cache HIT events
- **Cache Invalidation**: On URL update/delete, call `purgeNginxCache(shortCode)` to clear Nginx cache

### Static Asset Cache (Browser)
Version-based cache busting via `src/utils/asset-version.ts`:
- **JS/CSS**: `Cache-Control: public, max-age=31536000, immutable` (1 year) — safe because URL includes `?v={version}`
- **Images/fonts**: `Cache-Control: public, max-age=2592000` (30 days)
- **HTML pages**: `Cache-Control: no-cache` — always fetches latest (so version strings stay current)
- Version is read from `deno.json` `version` field at startup and injected into all HTML `<script src="/js/...">` references
- **On deploy**: bump `deno.json` version → restart → browsers auto-fetch new assets

## Authentication

- **Backend**: JWT from `Authorization: Bearer <token>` header
- **Frontend**: Supabase client in `public/js/auth.js`
- **Keycloak OIDC**: Configured via Supabase GoTrue (`GOTRUE_EXTERNAL_KEYCLOAK_*` env vars)
- **User metadata** from Keycloak: `user.user_metadata.email`, `user.user_metadata.chinese_firstname`, `user.user_metadata.chinese_lastname`
- **Admin**: Identified by `ADMIN_EMAILS` env var (comma-separated); sidebar auto-detects via `/api/admin/check`

## Environment Variables

Key variables in `.env`:
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
PORT, HOST, BASE_URL
ADMIN_EMAILS  # comma-separated admin email addresses
```

Supabase Keycloak OIDC is configured in `/docker/supabase/.env` with `GOTRUE_EXTERNAL_KEYCLOAK_*` variables.

## Service Management

The service is managed by systemd:
```bash
sudo systemctl start shorturl-api    # Start
sudo systemctl stop shorturl-api     # Stop (kills all child processes)
sudo systemctl restart shorturl-api  # Restart
sudo systemctl status shorturl-api   # Status
journalctl -u shorturl-api -f        # Live logs
```
