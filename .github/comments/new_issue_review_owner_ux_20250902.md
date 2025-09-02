## [UX] Review/Owner 小改善（自動in_review・日時整形・新着差戻し通知）

目的: レビュー～オーナー間のやり取りをスムーズにし、視認性/即時性を高める。

実装内容
- Review詳細: 初回表示時に `submitted` → `in_review` 自動遷移（監査記録付き）。
- Review/Owner一覧: 日時をローカル時刻で整形表示。空/エラー文言を改善。
- Owner: 最新の差戻し理由を上部バナーに表示。localStorageで「新着」既読管理を追加。

確認手順
1. `/review/:id` で `submitted` の案件を開く → `in_review` に変化し監査に反映。
2. `/review` `/owner/:locationId` の日時が読みやすく表示されること。
3. Reviewerが `needs_fix`（理由あり）→ Ownerページで「新着」バナー表示 → 「既読にする」で消える。

備考
- 今後: メール/Slack通知の実装フックに接続予定（API/Worker実装は別Issue）。

