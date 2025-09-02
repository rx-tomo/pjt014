## [Owner] 差戻し理由の可視化（Ownerポータル）

目的: needs_fix の理由をオーナーが即時把握できるよう、Ownerポータルで理由を明示する。

実装内容
- UI: `/owner/:locationId` に最新の差戻し理由バナーを追加（最上部カード内）。
- UI: 依頼一覧に Reason カラムを追加（needs_fix時は強調表示）。
- API: `GET /api/change-requests/:id` のレスポンスに `review_note` を追加（in-memory時の整合性）。

確認手順
1. レビュー側で `needs_fix` + `reason` を設定
2. `/owner/:locationId` を開く → バナーに最新理由が表示、一覧の Reason 列にも表示

備考
- Supabase接続時は `owner_change_requests.review_note` をOutbox経由で保存（先行マイグレーション 0010 で列追加済み）。

