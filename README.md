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
- `/api/gbp/callback` は取得した tokens を保存し、`refresh_token` は `TOKEN_ENCRYPTION_KEY`（Base64 32バイト）で暗号化して `oauth_tokens` に格納します（`0002`/`0003` マイグレーション）。
- 本番では KMS/Secrets 等で鍵管理し、ユーザ/テナントに紐付けてください。
```

## RLS & Audit
- RLS: ユーザは所属組織のデータのみ閲覧/操作可能（`memberships` 経由）。`supabase/migrations/0004_rls_audit.sql` を参照。
- Audit: `organizations`/`locations`/`change_requests`/`batches`/`sync_runs` に対して挿入・更新・削除を `audit_log` に記録。
- 注意: 本アプリの `lib/db.ts` は Postgres に直接接続します（サービス権限）。RLSの効果検証には Supabase の `anon/authenticated` 役割＋JWT を用いるか、`@supabase/supabase-js` を通す必要があります。

## Env

- `.env.local` を Next.js 用に使用
- `.env` は worker 用（同値でも可）
- `TOKEN_ENCRYPTION_KEY` を `openssl rand -base64 32` で生成し設定

## Deploy

- FE: Vercel
- DB: Supabase (PG15)
- Worker: Cloud Run or Supabase Edge Functions（将来切替可）
