進捗更新: RLSと監査ログを実装し、ローカルDBに適用しました。

- 実装: `supabase/migrations/0004_rls_audit.sql`
  - oauth_tokens: RLS有効化（ポリシー未付与=完全閉鎖、service_roleのみ）
  - audit_logテーブル作成 + 汎用トリガー（oauth_tokens/tenants/organizations/locations）
- 適用: `supabase db reset` で反映済み
- 関連コミット: bd7cac2

このIssueのスコープは満たしたためCloseします。必要があればサブタスク（暗号化スキーマ/RLS詳細化）で別Issueに切り出します。

