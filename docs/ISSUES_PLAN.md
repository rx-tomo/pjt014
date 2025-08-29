# Issues & Milestones Plan

このドキュメントは GitHub の Issue/Milestone 運用の台本です。`gh` CLI が使える環境では `make gh-bootstrap && make gh-issues` を実行すると、ここに列挙の大枠が自動作成されます。

## Milestones (Ordered)
- 01. MVP
- 02. OAuth & Tokens
- 03. Supabase Schema
- 04. Worker & Jobs
- 05. Admin UI
- 06. Security & Compliance

## Issues（概要）
- MVP: Next.js/Tailwind/Supabase/Worker スキャフォールド（完了ベース）
- OAuth: GCPクライアント作成と.env設定
- トークン保管方式の決定と実装方針
- RLS ポリシーと監査ログの実装
- ジョブ投入APIのバリデーション強化（Zod）
- Worker のレート制御強化（トークンバケット）
- ジョブ投入UIのUX改善（プリセット/検証）
- 管理UI: 一覧/承認/バッチ画面の雛形
- 秘密情報管理・ローテーション方針の確定

### 新規（オーナー/代理店の利用価値に直結）
- Owner Portal: ダッシュボードと変更依頼フォーム、進捗トラッキング、通知
- Reporting: GBP Insights 収集/集計、CSV/定期レポート配信
- Compliance: 医療法等ガイドライン準拠チェック、チェックリスト運用、AIサジェスト
- Approvals: レビュアー→承認者のダブルチェック（4-eyes）、差戻し運用
- Notifications & SLA: 期限管理/遅延通知/失敗通知（メール/Slack）
- Billing: プラン/請求/支払い（将来フェーズ）

該当シナリオ・ワークフローは `docs/product/USE_CASES.md` と `docs/product/WORKFLOWS.md` を参照。

## Close 時のコメント例
> 実装・確認完了しました。ビルド/リンタ/ローカル検証OK。関連PR: #<PR番号>。必要に応じてフォローアップIssueを作成します。
