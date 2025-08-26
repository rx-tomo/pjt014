#!/usr/bin/env bash
set -euo pipefail

# Create milestones and issues for this repo using GitHub CLI.
# Usage: scripts/gh-create-issues.sh [owner/repo]

repo="${1:-}"
if [ -z "$repo" ]; then
  repo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
fi

echo "Target repo: $repo"

# Ensure base labels/milestones exist (idempotent)
"$(dirname "$0")/gh-bootstrap.sh" "$repo"

echo "Creating issues..."

# Helper to create an issue
create_issue() {
  local title="$1"; shift
  local body="$1"; shift
  local labels="$1"; shift
  local milestone="$1"; shift
  gh issue create --repo "$repo" \
    --title "$title" \
    --body "$body" \
    --label $labels \
    --milestone "$milestone" || true
}

# MVP
create_issue \
  "MVP: Next.js/Tailwind/Supabase/Worker スキャフォールド" \
  $'- 既存コードの初期化と基本動作確認\n- app/layout, /api/gbp/*, supabase/migrations, worker の追加\n- 受け入れ条件: dev 起動・OAuthリンク表示・DBリセット動作・worker 起動' \
  "type:feat,area:api,area:worker" \
  "MVP"

# OAuth & Tokens
create_issue \
  "OAuth: GCPクライアント作成と.env設定" \
  $'- GCP で OAuth 同意画面(テスト)と Web クライアント作成\n- .env.local に CLIENT_ID/SECRET/REDIRECT_URI を設定\n- 受け入れ条件: /api/gbp/oauth→/callback で tokens JSON 取得' \
  "type:feat,area:api" \
  "OAuth & Tokens"

create_issue \
  "トークン保管方式の決定と実装方針" \
  $'- KMS/Secrets/DB暗号化 いずれかの方針決定\n- テナント紐付けモデルの下書き\n- 受け入れ条件: 設計メモと実装タスク分割' \
  "type:chore,area:api" \
  "OAuth & Tokens"

# Supabase Schema
create_issue \
  "RLS ポリシーと監査ログの実装" \
  $'- tenants/organizations/locations のRLS\n- memberships と auth.uid() による境界\n- 受け入れ条件: テストユーザでの最小検証' \
  "type:feat,area:api" \
  "Supabase Schema"

# Worker & Jobs
create_issue \
  "ジョブ投入APIのバリデーション強化（Zod）" \
  $'- /api/jobs/gbp-patch に Zod 追加\n- 受け入れ条件: 異常系で 400/422 が返る' \
  "type:feat,area:api" \
  "Worker & Jobs"

create_issue \
  "Worker のレート制御強化（トークンバケット）" \
  $'- Redis or in-memory トークンバケット設計\n- 受け入れ条件: 設計済み・最小実装・ログ確認' \
  "type:feat,area:worker" \
  "Worker & Jobs"

create_issue \
  "ジョブ投入UIのUX改善（プリセット/検証）" \
  $'- スコープ/更新マスクのプリセット\n- JSON 検証とエラーハイライト\n- 受け入れ条件: 入力補助とバリデーション' \
  "type:feat,area:ui" \
  "Worker & Jobs"

# Admin UI
create_issue \
  "管理UI: 一覧/承認/バッチ画面の雛形" \
  $'- ロケーション/変更要求/バッチの一覧\n- 受け入れ条件: 画面遷移とダミーデータ表示' \
  "type:feat,area:ui" \
  "Admin UI"

# Security & Compliance
create_issue \
  "秘密情報管理・ローテーション方針の確定" \
  $'- 環境変数/Secrets/KMS の整理\n- 受け入れ条件: ドキュメント反映と自動化案' \
  "type:chore" \
  "Security & Compliance"

echo "All issues created (or already existed)."

