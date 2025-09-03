# 本番運用ランブック（pjt014）

本書は、最小構成で本番稼働させるための手順と運用指針をまとめたものです。段階導入（まずはHTTPS終端＋単一ノード、次にジョブ/DB強化）を前提にしています。

## 1. 前提と構成

- ランタイム: Node.js 22
- サーバ: 軽量HTTPサーバ（`src/core/server.js`）をプロセスマネージャー（systemd 等）で常駐
- リバースプロキシ: 任意（例: Nginx / ALB）でHTTPS終端
- データストア: Supabase（任意。接続なしでもメモリで動作し、Outboxで後送）
- ジョブ: 将来のpg-boss/Workerは任意（現段階は必須ではない）

## 2. 環境変数（必須/推奨）

- 必須（OAuth可視化のみでも推奨）
  - `NODE_ENV=production`
  - `HOST=0.0.0.0`
  - `PORT=3014`（任意）
  - `APP_SECRET`（署名/セッション用の十分長いランダム文字列）
  - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`（OAuth）
  - `GOOGLE_REDIRECT_URI`（例: `https://<domain>/api/gbp/callback`）

- Supabase連携（任意・設定時は永続化ON）
  - `SUPABASE_URL`（RESTエンドポイント）
  - `SUPABASE_SERVICE_ROLE_KEY`（Service Role Key。サーバ専用。厳重管理）

- 追加（ジョブ/pg-bossを使う場合のみ）
  - `SUPABASE_DB_URL`（pg-boss接続用のDB URL）

- セキュリティ/運用（強く推奨）
  - `COOKIE_SECURE=1`（HTTPS配下でCookieにSecure付与）
  - `ALLOWED_ORIGINS="https://admin.example.com,https://owner.example.com"`（CORSを限定）

- 通知（任意）
  - `NOTIFY_PROVIDER=none|console|webhook`
  - `NOTIFY_WEBHOOK_URL=https://hooks.example.com/endpoint`（webhook選択時）

- Outbox再試行（任意）
  - `OUTBOX_MAX_ATTEMPTS=9`（既定9。到達時にfailedへ遷移）

注意: `.env` は本番では使わず、OSレベルのSecret管理（systemdの`Environment=`、Vault、またはクラウドのシークレット）を使用します。

## 3. Google OAuth 設定

1) GCPでOAuth同意画面（External/テストでも可）をセットアップ
2) クライアントID（Web）を発行し、リダイレクトURIに `https://<domain>/api/gbp/callback` を追加
3) 上記のクレデンシャルを環境変数に設定

## 4. Supabase 準備（任意だが推奨）

1) プロジェクト作成後、SQLマイグレーションを適用
   - `supabase/migrations/0001_init.sql` ～ 最新（例: `0009_audit_logs.sql`）
2) RLS/ポリシーの確認
   - `owner_change_requests` のRLSはメール境界（自身のみ）
   - `audit_logs` はデフォルトで `actor_email`=自身のみ参照
3) APIキー（Service Role Key）をサーバに設定（公開フロントには渡さない）

## 5. デプロイ手順（systemd 例）

1) アプリ配置（/srv/app 等）
2) Node 22 をインストール
3) 依存不要（純Node）だが、リポジトリに同梱されたファイルで起動可
4) systemd ユニット例

```
[Unit]
Description=pjt014 server
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/pjt014
ExecStart=/usr/bin/env NODE_ENV=production HOST=0.0.0.0 PORT=3014 \
  APP_SECRET=xxxx GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=xxx \
  GOOGLE_REDIRECT_URI=https://example.com/api/gbp/callback \
  SUPABASE_URL=https://xxx.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=eyJ... \
  node src/core/server.js
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

5) `systemctl enable --now pjt014.service`

## 6. リバースプロキシ（Nginx 例）

- HTTPSは必須（Let’s Encrypt等）。HTTP→HTTPSリダイレクト
- X-Forwarded-For/Proto を付与
- タイムアウトはロングポーリング/SSEを考慮して適切に（現状SSEはdevのみ）

```
location / {
  proxy_pass http://127.0.0.1:3014;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 7. Cookie/セキュリティ

- 本番はHTTPS前提。Cookieは `HttpOnly; SameSite=Lax; Secure` を推奨
  - `COOKIE_SECURE=1` を設定（未設定かつ `NODE_ENV=production` の場合は警告をログに出力）
- CORSは本番で必ず限定
  - `ALLOWED_ORIGINS` に許可オリジンをカンマ区切りで指定。未指定時は `*`（開発向け）

## 8. ヘルスチェック

- `GET /` → 200（HTML）
- `GET /api/dashboard` → `{ ok: true, config, session, persistence }`
- 監査や依頼の応答例
  - `GET /api/change-requests` → `{ ok: true, items: [...] }`
  - `GET /api/audits?entity=change_request&id=<id>` → `{ ok: true, items: [...] }`

## 9. 運用（監視・ログ）

- 重要ログ: 起動・HTTPアクセス（server.jsのstart/finishログ）・Outbox再試行（warning）
- 監視の最低限
  - 応答コード割合（5xx検知）
  - Outbox滞留数（ログで可視）
  - Supabaseエラー率（`[sb]`ログ）
  - Outboxのfailed件数（`/api/change-requests/:id/sync` で個別確認）

## 10. バックアップ/ローテーション

- アプリ側はステートレス（DBはSupabase側でバックアップ）
- ログはjournaldやfilebeat等で集約・ローテーション

## 11. ロールアウト/ロールバック

- ロールアウト: 新バージョンを展開→systemd再起動→ヘルスチェック
- ロールバック: 前バージョンへファイルを戻して再起動
- DB変更: 先にマイグレーション適用→アプリ更新（互換のない変更は事前調整）

## 12. よくある質問（FAQ）

- Q: Supabase未設定で稼働できますか？
  - A: はい。依頼はメモリ保存、永続化はOutboxが保留します（エラーではない）。
- Q: 監査ログはどこで見られますか？
  - A: `/review/:id`の「監査ログ」か、`/api/audits?entity=change_request&id=<id>`。
- Q: ジョブ実行は？
  - A: 本MVPでは手動/擬似。`app/api/jobs/gbp-patch`はNext.jsランタイム前提のため別ホスト/将来導入を検討。
- Q: 通知はどこで設定しますか？
  - A: `NOTIFY_PROVIDER=console|webhook` を設定。webhookの場合は `NOTIFY_WEBHOOK_URL` も設定。
- Q: 同期がpending/failedのままです。
  - A: `/api/change-requests/:id/sync` で状態を確認し、必要なら `/api/change-requests/:id/resync` を実行。

## 13. 今後の本番強化TODO

- Cookie `Secure`の強制と`SameSite`運用の明文化（導入済・運用ガイド拡充）
- CORSオリジン制限（導入済・運用ガイド拡充）
- レート制限/DoS対策（プロキシ/アプリ）
- 監査ログの項目拡張（差戻し理由・外部API応答）
- pg-bossワーカーの常駐化（systemdユニット追加）

## 14. 通知運用（任意）

- 方針: Slack等にロックインせず、console/webhookから開始
- 設定例
  - `NOTIFY_PROVIDER=webhook`
  - `NOTIFY_WEBHOOK_URL=https://hooks.example.com/endpoint`
- 対象イベント（初期）
  - 変更依頼の状態更新: needs_fix / approved（owner宛てを想定）
- 将来拡張
  - メール（SMTP/SendGrid等）/ その他チャネルの追加、テンプレート整備

## 15. Outbox運用（再送/最終整合）

- 状態: queued → retrying → failed（最大試行に到達）
- 再送: `/api/change-requests/:id/resync` で手動再送（idempotent）
- 監視: `OUTBOX_MAX_ATTEMPTS` の調整とfailed監視
