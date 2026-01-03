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
├── API routes: /api/* → src/routes/urls.ts
└── Auth: Supabase JWT validation
```

## Key Files

| File | Purpose |
|------|---------|
| `src/main.ts` | Hono app entry, middleware (CSP, CORS, logging), static serving |
| `src/routes/urls.ts` | All URL CRUD, QR code, stats, password protection, redirect logic |
| `src/services/supabase.ts` | Supabase clients (service + user factory) |
| `src/services/click-log-watcher.ts` | Monitors Nginx logs and records cache HIT clicks |
| `src/utils/html-templates.ts` | Password prompt, expired, ad interstitial pages |
| `public/js/auth.js` | Frontend Supabase auth (includes Google OAuth) |

## Database Schema

**Main tables**:
- `urls` - short URLs with `qr_code_options` (JSONB), `password_hash`, `expires_at`
- `url_clicks` - click tracking with `click_type` ('link' or 'qr')

**Views**:
- `url_total_stats` - aggregated total clicks per URL
- `url_daily_stats` - daily breakdown

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
- `imgSrc` - for images (includes `*.googleusercontent.com` for OAuth avatars)
- `styleSrc` - for CSS
- `scriptSrc` - for JS

### 5. Nginx Caching
Only `/s/*` routes are cached by Nginx. API, static files, and other routes bypass cache.

## Cache Strategy

Caching is handled entirely by Nginx for `/s/*` routes:
- **Nginx caches 302 redirects** for short URLs (configurable TTL)
- **No application-level cache** (Redis removed for simplicity)
- **Click tracking**: ClickWatcher monitors Nginx logs for HIT events

**Cache Invalidation**: On URL update/delete, call `purgeNginxCache(shortCode)` to clear Nginx cache.

## Authentication

- **Backend**: JWT from `Authorization: Bearer <token>` header
- **Frontend**: Supabase client in `public/js/auth.js`
- **Google OAuth**: Configured via Supabase GoTrue (`GOTRUE_EXTERNAL_GOOGLE_*` env vars)
- **User metadata** from Google: `user.user_metadata.avatar_url`, `user.user_metadata.full_name`

## Environment Variables

Key variables in `.env`:
```
SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
PORT, HOST, BASE_URL
```

Supabase OAuth is configured in `/docker/supabase/.env` with `GOTRUE_EXTERNAL_GOOGLE_*` variables.

## Service Management

The service is managed by systemd:
```bash
sudo systemctl start shorturl-api    # Start
sudo systemctl stop shorturl-api     # Stop (kills all child processes)
sudo systemctl restart shorturl-api  # Restart
sudo systemctl status shorturl-api   # Status
journalctl -u shorturl-api -f        # Live logs
```
