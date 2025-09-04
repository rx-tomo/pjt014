# 通知運用ガイド（MVP）

## 目的
- needs_fix / approved など重要イベントの通知を、特定チャネルに依存せず最小構成で提供する。
- まずは console/webhook から開始し、将来的にメール等へ拡張可能な土台を整える。

## 設定
- `NOTIFY_PROVIDER=none|console|webhook`
- `NOTIFY_WEBHOOK_URL=https://hooks.example.com/endpoint`（webhook選択時）

## 仕組み
- 実装: `src/core/notifier.js`
- 呼び出し: 変更依頼のステータス更新（/api/change-requests/:id/status）で発火
- Supabase接続時は `notifications` テーブルにも保存（Outbox経由）

## ペイロード（例）
```
{
  "type": "change_request",
  "action": "approved",
  "target": "owner@example.com",
  "subject": "変更依頼が承認されました",
  "body": {
    "id": "<uuid>",
    "location_id": "loc1",
    "status": "approved",
    "reason": null
  },
  "ts": "2025-09-03T10:00:00.000Z"
}
```

## 将来拡張
- プロバイダ: email(SMTP/SendGrid)/Slack/Teams/Discord
- テンプレート: 多言語・ブランド対応、件名/本文の構造化
- 宛先解決: 組織/ロール/ロケーションに応じた配信先ルール
