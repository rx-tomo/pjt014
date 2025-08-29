# マイルストーンとDone条件

## 01. MVP
- OAuth連携・ダッシュボードで状態可視化（済）
- ロケーション一覧/詳細（読み取り）
- 変更申請→承認→同期（narrowスコープ: 営業時間/電話/URL/説明）
- 監査ログの参照（一覧/詳細）

## 02. OAuth & Tokens（対応中）
- OIDC検証（済）/ Refresh API（済）
- 暗号化保存スキーマ（済）/ ローテーション方針（#18）

## 03. Supabase Schema
- locations / change_requests / batches / sync_runs の正規化
- RLSの詳細化（テナント/ロール）

## 04. Worker & Jobs
- pg-boss導入、同期ジョブ、再試行/遅延キュー

## 05. Admin UI
- 承認キュー、差分ビュー、監査ビュー

## 06. Security & Compliance
- Cookie/HTTPS方針、本番環境設定、監査拡張

## 07. Owner Portal
- オーナー向けダッシュボード（主要KPIの期間比較）
- 変更依頼フォーム（証跡/希望反映日/優先度）と進捗トラッキング
- 依頼詳細/コメント/通知（メール/Slack）

## 08. Reporting & Insights
- GBP Insights 取り込み（期間・集計・キャッシュ）
- ダッシュボード/CSVエクスポート/定期メール

## 09. Compliance & AI Review
- チェックリストとダブルチェック（4-eyes）
- AIサジェスト/スコアリング（文言/画像）
- 監査ログの拡張（理由/根拠/差戻し履歴）

## 10. Billing & Payments（将来）
- プラン/請求/支払い（外部決済連携）
- ポータルでの請求書確認・支払い履歴

## 11. Rank Tracking & Reviews
- 対象KW群の順位トラッキング（準拠手段での取得）
- レビュー一元管理と返信テンプレ/監修導線
- KPI: ランキング中央値、返信率、初回応答時間
