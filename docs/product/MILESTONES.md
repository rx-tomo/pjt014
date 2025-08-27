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

