## [Review] 差戻し理由の保存＋監査 実装

目的: レビュー工程での差戻し理由をAPI/UIで必須化し、監査に記録することでやりとりの明確化と追跡性を高める。

実装内容
- UI: `/review/:id` に差戻し理由テキストエリアを追加。needs_fix時に必須入力。
- API: `POST /api/change-requests/:id/status` で `needs_fix` の場合 `reason` を必須化。
- 監査: `status:needs_fix` に `meta.reason` を記録（In-memory + Supabase Outbox）。
- Supabase: `owner_change_requests.review_note` 列を追加（マイグレーション追加、適用は別途）。

確認手順
1. `/owner` で依頼を作成→ `/review` に表示されること
2. `/review/:id` でチェック保存→メッセージ表示されること
3. 差戻し: 理由未入力でエラー、理由入力の上で `needs_fix` → 成功
4. 監査: `/review/:id` の「監査ログ」に `status:needs_fix` と理由が表示、または `GET /api/audits?entity=change_request&id=<id>`

メモ
- Supabase連携ありの場合、`owner_change_requests.review_note` にも保存（Outbox経由）。
- 本番運用ランブック（docs/ops/PRODUCTION_RUNBOOK.md）を追加済み。

次アクション案
- needs_fixの理由をOwner側に通知（UI/メールは後続）
- Review一覧に status フィルタ追加（submitted/in_review）
- Cookie Secure/CORSオリジンの本番フラグ化

