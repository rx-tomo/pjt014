## [Security] COOKIE_SECURE と CORS制御（ALLOWED_ORIGINS）の導入

目的: 本番運用時のセキュリティ基盤強化（HTTPS前提のCookie運用とCORS許可オリジンの限定）。

実装内容
- Cookie Secure: `COOKIE_SECURE` が `1/true`（未指定時は `NODE_ENV=production` で自動ON）
  - OAuth: `sid`, `oauth_state`, `oauth_nonce` に Secure 付与
  - Impersonate(Dev): `role` も Secure（本番でのDev機能は非利用想定）
  - `clear_cookie` に `secure` 対応（Secure Cookieも確実に削除）
- CORS: `ALLOWED_ORIGINS`（カンマ区切り）を指定時、マッチした `Origin` のみ許可
  - 未指定時は従来通り `*`（MVP開発の利便性を維持）

運用
- 本番: `COOKIE_SECURE=1` と `ALLOWED_ORIGINS="https://<domain>"` を設定
- Dev: 既定では緩く（Secure自動OFF/CORS=*）。必要に応じてALLOWED_ORIGINSを試験設定

確認
- ブラウザのDevToolsでSet-CookieのSecure属性確認
- 異なるOriginからのリクエストで、許可/非許可の挙動を確認

