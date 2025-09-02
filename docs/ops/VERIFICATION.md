# 挙動確認手順（ローカル/E2E）

本書は、MVP機能の動作確認を手早く行うためのチェックリストです。

## 0) 準備
- Node 22 / `make dev`
- OAuthは必須ではありません（Owner/Reviewデモはdevのimpersonateで可）
- 通知確認:
  - console: `NOTIFY_PROVIDER=console`
  - webhook: `NOTIFY_PROVIDER=webhook`, `NOTIFY_WEBHOOK_URL=...`

起動（例）
```
NODE_ENV=development DEV_RELOAD=1 NOTIFY_PROVIDER=console \
  node src/core/server.js
```

## 1) Owner: 依頼作成
- ブラウザ: `http://localhost:3014/owner`
- devメニュー右上から Role=owner を設定（`/__dev/impersonate?role=owner`）
- 注意: devのOwnerは許可されたロケーションのみ編集可能（既定は `owner1@example.com` → `loc1`）。他のIDを使う場合は環境変数で上書き:
  - `DEV_OWNER_EMAIL=you@example.com`
  - `DEV_OWNER_LOCATIONS=loc1,loc2`
- ロケーションを選択 → フォーム入力
  - 説明にNGワードを入れると自動チェックで警告
  - チェックボックス「オーナーによる内容確認」をON
  - 送信 → 下の一覧に追加される（Status=submitted）

## 2) Review: 一覧・詳細
- `http://localhost:3014/review` に移動（Role=reviewer）
- 一覧で status=submitted フィルタに切り替え → 先ほどの依頼が見える
- IDをクリック → 詳細へ
  - 初回表示で `submitted → in_review` に更新（画面上のStatus表示で確認）
  - 自動チェックとチェックリストの保存を試す

## 3) 差戻し（needs_fix）
- 理由欄に差戻し理由を入力 → 差戻しボタン
- 成功メッセージ表示、監査ログに `status:needs_fix` と理由が出る
- 通知:
  - consoleの場合: ターミナルに `[notify]` ログが出る
  - webhookの場合: 受信側でJSONを確認

## 4) Owner: 差戻し理由の確認
- `http://localhost:3014/owner/<locationId>` を開く
- 上部に「最新の差戻し理由」バナー（新着ラベル付き）
- 「既読にする」を押すと新着ラベルが消える（localStorage）
- 一覧の Reason 列にも理由が表示

## 5) 承認（approved）
- 再度Reviewで該当依頼を開き、承認
- 監査に `status:approved`、通知ログを確認

## 6) 監査API
- curl: `curl -s 'http://localhost:3014/api/audits?entity=change_request&id=<id>' | jq .`
- 作成/チェック保存/差戻し/承認の履歴が見える

## 7) Supabase接続時（任意）
- `SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` を設定
- 依頼作成/更新で Outbox が `owner_change_requests` と `audit_logs` に書き込む
- 通知は `notifications` に記録される

## 8) セキュリティ（本番準備）
- `COOKIE_SECURE=1` でSet-CookieにSecureが付く
- `ALLOWED_ORIGINS="https://example.com"` を設定し、Originが一致しない場合にCORSが無効になることを確認

トラブルシュート
- Outboxの再送は指数バックオフで実施。サーバログの `[outbox]` を参照
- Supabaseエラーは `[sb]` ログにHTTPステータスや遅延が出力
