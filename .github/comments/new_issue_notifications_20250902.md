## [Notify] チャネル非依存の通知土台（console/webhook）

目的: Slack等に依存せず、将来的にメール/他チャネルへ拡張可能な通知の土台を用意する。

実装内容
- `src/core/notifier.js`: 共通 `notify({type,action,target,subject,body})` 実装。`NOTIFY_PROVIDER=none|console|webhook` を選択。
- ステータス更新: `needs_fix` / `approved` で通知を発火（Ownerメールをtargetに想定）。
- Outbox: Supabase接続時は `notifications` テーブルに挿入（0011マイグレーション）。
- ENV: `NOTIFY_PROVIDER`, `NOTIFY_WEBHOOK_URL` を README に追記。

確認手順
1. `NOTIFY_PROVIDER=console` で `needs_fix`/`approved` を実行 → サーバログに [notify] 出力
2. `NOTIFY_PROVIDER=webhook` とURL設定 → 受信側でJSONを確認
3. Supabase接続時: `notifications` に記録されること

今後
- メール（SMTP/SendGrid）/Teams/Discord等のプロバイダ追加
- 通知テンプレ（多言語/ブランド）と宛先解決（組織/ロール）

