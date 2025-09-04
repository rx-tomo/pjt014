# 変更依頼フロー（実装仕様まとめ）

本ドキュメントは、現状実装されている変更依頼（Owner→Review→承認/差戻し）に関する仕様をまとめます。

## 概要
- 対象: Google Business Profile の基本項目（電話/営業時間/URL/説明/写真URL）
- 主要ロール: Owner（依頼作成）/ Reviewer（レビュー・承認/差戻し）
- 保存: メモリ（ローカル）＋ Supabase（任意接続）
- 補助: 自動コンプライアンスチェック、監査ログ、通知（console/webhook）

## 状態遷移（ステート）
- `submitted` → `in_review` → `approved | needs_fix` → `syncing` → `synced | failed`
- 実装済みの主な遷移: `submitted ↔ in_review`, `needs_fix`, `approved`
- Review詳細を開くと `submitted → in_review` に自動遷移（監査記録）

## エンドポイント（抜粋）
- `GET /api/change-requests?location_id=<id>&status=<state>` 一覧
- `GET /api/change-requests/:id` 単体
- `POST /api/change-requests` 作成
  - 必須: `location_id`, `owner_signoff=true`
- `POST /api/change-requests/:id/status` 状態更新
  - `needs_fix` の場合 `reason` 必須（監査に理由を保存 / Supabaseは `review_note`）
- `POST /api/change-requests/:id/checks` レビューチェック保存（JSONブール）
- `GET /api/change-requests/:id/compliance` 自動チェック結果
- 監査: `GET /api/audits?entity=change_request&id=<id>`

## curl例
```
# 作成（オーナー同意必須）
curl -s -X POST http://localhost:3014/api/change-requests \
  -H 'content-type: application/json' \
  -d '{"location_id":"loc_001","phone":"0312345678","owner_signoff":true}'

# 一覧
curl -s 'http://localhost:3014/api/change-requests?status=submitted'

# 単体
curl -s 'http://localhost:3014/api/change-requests/<id>'

# 差戻し（理由必須）
curl -s -X POST http://localhost:3014/api/change-requests/<id>/status \
  -H 'content-type: application/json' \
  -d '{"status":"needs_fix","reason":"表現修正が必要"}'

# 承認
curl -s -X POST http://localhost:3014/api/change-requests/<id>/status \
  -H 'content-type: application/json' \
  -d '{"status":"approved"}'

# 監査
curl -s 'http://localhost:3014/api/audits?entity=change_request&id=<id>'
```

## UI（/owner, /review）
- `/owner/:locationId`
  - フォーム: 限定項目の入力 + 自動チェック（説明文） + オーナー同意必須
  - 一覧: 最新順。Reason列で差戻し理由を強調
  - 新着差戻し理由バナー: 最新の needs_fix 理由を上部に表示。localStorageで既読管理
- `/review` 一覧
  - 状態フィルタ（submitted/in_review/…）
  - 日時整形、空/エラー表示の改善
- `/review/:id` 詳細
  - 自動チェック表示、チェックリスト保存
  - 承認/差戻し（理由必須）ボタン、レビュー開始ボタン
  - 監査ログの表示
  - 初回表示時に `submitted → in_review` 自動遷移

## 監査ログ
- In-memoryで保持し、Supabase接続時は `audit_logs` に保存（Outbox）
- 記録タイミング: 作成、チェック保存、状態変更（needs_fix理由含む）

## 通知（チャネル非依存）
- モジュール: `src/core/notifier.js`
- ENV:
  - `NOTIFY_PROVIDER=console|webhook|none`（default: none）
  - `NOTIFY_WEBHOOK_URL=...`（webhook時）
- トリガー: `needs_fix` / `approved`
- 保存: Supabase接続時は `notifications` に履歴保存（Outbox）
- 例（webhookペイロード）:
```
{
  "type":"change_request",
  "action":"needs_fix",
  "target":"owner@example.com",
  "subject":"変更依頼が差戻しになりました",
  "body":{"id":"<id>","location_id":"loc_001","status":"needs_fix","reason":"表現修正が必要"},
  "ts":"2025-09-02T12:34:56.000Z"
}
```

## セキュリティ/運用
- Cookie Secure: `COOKIE_SECURE=1`（未指定時は本番で自動ON）
- CORS: `ALLOWED_ORIGINS` 指定で許可オリジンを限定
- 本番運用手順は `docs/ops/PRODUCTION_RUNBOOK.md` を参照

