# Web Components Refactor + Favicon Unification

**Date:** 2026-03-12
**Status:** Approved

## Problem

1. **Sidebar duplication**: The sidebar HTML is copy-pasted across 6 pages (index, edit, links, analytics, feedback, feedback-detail). Changing a nav item requires editing 6 files.
2. **Tailwind config duplication**: Identical `tailwind.config` script block repeated in every HTML page.
3. **Missing favicon on server-rendered pages**: `html-templates.ts` generates inline HTML for password, expired, ad interstitial, and not-found pages without any favicon or consistent head meta.
4. **External favicon dependency**: All pages use `https://info.tzuchi.org/favicon.svg` instead of the local `/favicon.svg` that already exists.

## Prior Attempt

A full 25-component Web Components library (`tc-button`, `tc-input`, `tc-modal`, etc.) was built but abandoned due to excessive bugs. The approach was too broad — most components (buttons, inputs, modals) work fine as plain HTML with Tailwind.

## Design Decision

**Only extract components where duplication causes real maintenance pain.** Three Web Components + one server-side utility function.

## Scope

### 1. `<tc-head-meta>` — Shared `<head>` injection

**File:** `public/js/components/tc-head-meta.js`

A Web Component placed in `<head>` that injects:
- Favicon: `<link rel="icon" type="image/svg+xml" href="/favicon.svg">`
- Tailwind CSS + config (colors, fonts, border-radius)
- Material Symbols stylesheet + font-variation-settings
- Google Fonts (Space Grotesk)

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Page Title - TCurl</title>
  <script src="/js/components/tc-head-meta.js"></script>
  <tc-head-meta></tc-head-meta>
</head>
```

Zero configuration. Replaces ~30 lines of duplicated head content per page.

### 2. `<tc-sidebar>` — Navigation sidebar

**File:** `public/js/components/tc-sidebar.js` (rewrite existing)

```html
<tc-sidebar active="links"></tc-sidebar>
```

**Attributes:**
- `active`: `"home" | "links" | "analytics" | "feedback"` — highlights the active nav item

**JavaScript API:**
- `sidebar.setUser({ name, email, avatar })` — show authenticated user info
- `sidebar.clearUser()` — show login prompt

**Responsibilities:**
- Logo + v1.0.0 badge
- Navigation menu (4 items: Home, My Links, Analytics, Feedback)
- User section (avatar, name, email, logout button)
- Login section (for unauthenticated users)
- Mobile: hamburger toggle, overlay backdrop, close button
- Responsive: hidden on mobile by default, fixed sidebar on `lg+`

**Events:**
- `tc-logout` — dispatched when logout button clicked (parent handles auth logic)

### 3. `<tc-page-header>` — Page title section

**File:** `public/js/components/tc-page-header.js` (new)

```html
<tc-page-header title="My Links" description="Manage all your short URLs">
  <button slot="actions">Create New</button>
</tc-page-header>
```

**Attributes:**
- `title`: Page title text
- `description`: Subtitle/description text

**Slots:**
- `actions`: Right-aligned action buttons

### 4. `htmlHead()` — Server-side head utility

**File:** `src/utils/html-templates.ts` (modify existing)

```typescript
function htmlHead(title: string): string
```

Returns a complete `<head>` inner content string for server-rendered pages:
- charset, viewport meta
- Title with "- TCurl" suffix
- Favicon: `/favicon.svg`
- Inline Tailwind config (same colors/fonts as client-side)
- Material Symbols

Used by: `renderPasswordPage()`, `renderExpiredPage()`, `renderAdPage()`, `renderNotFoundPage()`

## Favicon Changes

| Location | Before | After |
|----------|--------|-------|
| All `public/*.html` | `https://info.tzuchi.org/favicon.svg` | `/favicon.svg` (via `<tc-head-meta>`) |
| `html-templates.ts` pages | No favicon | `/favicon.svg` (via `htmlHead()`) |
| Sidebar logo `<img>` | `https://info.tzuchi.org/favicon.svg` | `/favicon.svg` |

The local file `public/favicon.svg` already exists and will be used.

## Test Page

**File:** `public/test/components.html`

A standalone page that demonstrates all three components working together:
- Full sidebar with mock user data
- Page header with action buttons
- Head meta injection
- Mobile responsive behavior

Accessible at: `http://localhost:3000/test/components.html`

## Files Changed

### New files
- `public/js/components/tc-head-meta.js`
- `public/js/components/tc-page-header.js`
- `public/test/components.html`

### Modified files
- `public/js/components/tc-sidebar.js` — full rewrite
- `src/utils/html-templates.ts` — add `htmlHead()`, update all render functions
- `public/index.html` — replace sidebar HTML + head content with components
- `public/edit.html` — same
- `public/links.html` — same
- `public/analytics.html` — same
- `public/feedback.html` — same
- `public/feedback-detail.html` — same
- `public/login.html` — replace head content (no sidebar on login)
- `public/password.html` — replace head content
- `public/expired.html` — replace head content
- `public/privacy.html` — replace head content

## Out of Scope

- No `tc-button`, `tc-input`, `tc-modal`, or other fine-grained UI components
- No changes to routing, API, or backend logic
- No changes to auth flow
- Sidebar logo `<img>` src changes from external to `/favicon.svg` (not `/images/tzuchi-logo.svg`)
