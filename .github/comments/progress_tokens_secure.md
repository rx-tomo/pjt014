進捗更新: トークン保管方式の決定と実装方針を反映しました（暗号化保存の導入）。

- 追加テーブル: `public.oauth_tokens_secure`
  - カラム: email, id_token_enc, access_token_enc, refresh_token_enc（いずれもAES-256-GCMで暗号化したbase64url文字列をtext保存）
  - RLS: 有効（ポリシー未付与＝完全閉鎖）。監査トリガ `fn_write_audit` を付与
- マイグレーション: `supabase/migrations/0005_oauth_tokens_secure.sql` を適用
- サーバ実装: `/api/gbp/oauth/callback` および `/api/gbp/oauth/refresh` で secure へ保存（失敗時は JSON スキーマへフォールバック）
- 鍵管理: `APP_SECRET` からscryptで鍵を導出（`src/core/crypto.js`）。ローテーション方針は #18 にて扱う予定

関連コミット: HEAD（このIssueに紐づく変更一式）

