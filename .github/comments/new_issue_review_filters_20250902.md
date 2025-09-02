## [Review] 一覧のステータスフィルタとレビュー開始ボタン

目的: レビュー運用の回しやすさを向上するため、キューの絞り込みと「レビュー開始（in_review）」導線を追加。

実装内容
- API: `GET /api/change-requests?status=...` を追加（Supabase/メモリ両対応）。
- UI: `/review` にステータスドロップダウン（all/submitted/in_review/...）。選択でQSを更新して再読込。
- UI: `/review/:id` に「レビュー開始（in_review）」ボタンを追加（終端状態では非表示）。現在のStatusを表示。

確認手順
1. `/review` を開く→ドロップダウンで `submitted` 選択→該当のみ表示
2. `/review/:id` → Start Review → Statusが `in_review` に変わる（監査は status:in_review を記録）

補足
- 先行実装の差戻し理由 必須化（#38）と併用可能。
- フロントはプレーンHTML/JSで実装（サーバ組込みUI）。

