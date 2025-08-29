# ワークフロー定義（申請→レビュー→承認→同期→監査）

## 変更申請の状態遷移（state machine）

- draft → submitted → in_review → needs_fix → approved → (owner_signoff optional) → syncing → synced | failed
  - draft: オーナー/担当が作成、未提出
  - submitted: 提出済み、レビュー待ち
  - in_review: レビュアーがチェック中（チェックリスト/AI補助）
  - needs_fix: 差戻し（理由・修正点）
  - approved: 承認者が承認（4-eyes）
  - owner_signoff: 規制リスクが高い文言等はオーナー最終確認（契約で運用ポリシー選択）
  - syncing: GBP APIへ反映中（update_maskで限定更新）
  - synced: 正常反映
  - failed: 反映失敗（再試行/原因管理）

関連テーブル（現状/計画）: `change_requests`（既存）、`batches`（既存）、`sync_runs`（既存）、`compliance_reviews`（計画）

## 役割と権限（例）

- owner: 依頼作成/提出、進捗確認、コメント
- operator: 依頼整形、差分作成、一次レビュー、同期実行
- reviewer: コンプライアンス/品質チェック、差戻し/承認提案
- approver: 最終承認（ダブルチェック）
- auditor: 閲覧・エクスポートのみ

RLSは `users`/`memberships`/`roles` を用いてテナント/組織境界を強制。

## コンプライアンスチェック（人/AI併用）

- 入力: 文面/画像/メタ（カテゴリ/診療科等）
- 処理: ルールベースのチェックリスト + AIスコアリング/ハイライト
- 出力: 違反/注意/OK、根拠リンク、修正文案案

## 通知とSLA

- SLA例: 依頼受付→初回レビュー ≤ 24h、承認→休診反映 ≤ 24h、レビュー返信 初回応答 ≤ 48h
- 遅延/失敗/差戻しに対してメール/Slack通知

## 監査ログ

- 重要操作（提出/承認/反映）の実施者・日時・差分・外部応答（ステータス/エラー）を保持
