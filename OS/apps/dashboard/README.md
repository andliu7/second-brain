# Dashboard

Weekly Bench, The Long View, and Today & Triage — merged from claude.ai artifacts into one
Supabase-backed React site, gated by Google sign-in so the data lives outside claude.ai.

## Stack, and why

- **React + TypeScript + Vite + Tailwind** — same stack as `blueberry_game`, so nothing new
  to learn to touch this later.
- **Supabase** (project `andrew-dashboard`, org `blueberry`, separate from the Blueberry app's
  own project) — Auth (Google OAuth) + one Postgres table, `boards`, RLS-scoped to
  `auth.uid()`. One JSON blob per `(user_id, board_key)`, `board_key` in
  `weekly_bench | long_view | today_triage`. Mirrors exactly how the original artifacts stored
  their state (one big JSON object), so the React components are a near-direct port of the
  artifacts' logic, just persisting through Supabase instead of `artifactNs.publish()`.
- **GitHub Pages** at `andliu7.github.io/dashboard/` — a separate deploy target repo
  (`andliu7/dashboard`) from this source, because Pages serves one site per repo and this
  source lives inside `second-brain` per the decision to merge it in from the start.

## What did NOT carry over

`Today & Triage`'s live Gmail / Calendar / Drive panels only work inside a claude.ai artifact
(`window.claude.use("mcp")`). Outside that, they have nothing to talk to. This version instead
shows *today's Weekly Bench items* and keeps the internship pipeline tracker (now saved to
Supabase instead of `localStorage`, so it follows you across devices). Real Google Calendar /
Gmail integration here would mean standing up your own Google Cloud OAuth app — a separate,
bigger follow-up, not done as part of this merge.

## One-time setup (you, not me — needs your accounts)

1. **Google OAuth client** (Google Cloud Console → APIs & Services → Credentials → OAuth
   client ID, type "Web application"):
   - Authorized redirect URI: `https://uahfbnteqqnrdqnahmqk.supabase.co/auth/v1/callback`
2. **Supabase** (dashboard.supabase.com → project `andrew-dashboard` → Authentication →
   Providers → Google): paste the Client ID + Secret from step 1, enable the provider.
   Under Authentication → URL Configuration, add `https://andliu7.github.io/dashboard/` as
   a redirect URL.
3. **Local env**: `cp .env.example .env` (already has the project URL + publishable key —
   both public-safe, protected by RLS, not secrets).

## Commands

```
npm install
npm run dev        # local dev server
npm run build       # tsc -b && vite build -> dist/
npm run deploy      # builds, then pushes dist/ to andliu7/dashboard (main branch) via gh-pages
```

`npm run deploy` needs push access to `andliu7/dashboard` from wherever you run it (your own
git credentials — this repo's `origin` remote is unrelated to that one).

## What breaks the build

- Missing `.env` → `src/lib/supabase.ts` throws on load, on purpose, rather than silently
  pointing at nothing.
- `board_key` values are hardcoded in three places (`App.tsx`'s three `useBoard` calls) — add
  a fourth board by adding a fourth call + component, not by overloading an existing key.
