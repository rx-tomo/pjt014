# pjt014 — GBP 運用代行システム（MVP）

Stack: Next.js 15 / React 18 / TypeScript 5 / Tailwind / Supabase (PG15, Auth, RLS) / pg-boss / googleapis

## Quick Start

```bash
# 1) Clone
gh repo clone rx-tomo/pjt014
cd pjt014

# 2) Node
corepack enable
env | grep -q NVM_DIR || nvm use 22 || true

# 3) Install
npm i

# 4) Dev (FE)
cp .env.example .env.local
npm run dev
# App runs at http://localhost:3014

# 5) DB (local; optional)
npm run supabase:start
npm run db:reset

# 6) Worker (別端末/Pane)
npm run worker:dev

## Notes (OAuth tokens persistence)
- `/api/gbp/callback` は取得した tokens を暗号化し `oauth_tokens` テーブルへ保存します（`supabase/migrations/0003_encrypted_oauth_tokens.sql`）。
- 暗号化には `TOKEN_ENCRYPTION_KEY`（Base64 32バイト）を使用します。
```

## Env

- `.env.local` を Next.js 用に使用
- `.env` は worker 用（同値でも可）
- `TOKEN_ENCRYPTION_KEY` を Base64 32バイトで設定（`openssl rand -base64 32`）

## Deploy

- FE: Vercel
- DB: Supabase (PG15)
- Worker: Cloud Run or Supabase Edge Functions（将来切替可）
