# pjt014

開発用の最小構成をセットアップしました。Node.js (>=22) で動作する軽量HTTPサーバ、テスト、Lint/Format、各種スクリプト、Issueテンプレート等を含みます。

## プロジェクトの目的と価値（Why）

複数拠点（例: クリニック/店舗）の Google Business Profile を安全かつ一貫性をもって運用するための基盤を提供します。目的は、変更申請→承認→反映→監査という一連の業務を「権限管理（RLS）」「監査可能性」「自動化（ジョブ/レート制御）」の観点で最小構成から実用水準へ段階的に立ち上げることです。

- 主要な価値:
  - 一貫性: ロケーション情報の変更を申請/承認フローで統制し、反映状況を可視化
  - 安全性: OAuth/トークンの取り扱いを分離・暗号化し、RLSでデータ境界を厳格化
  - 監査性: だれが・いつ・何を変更したかを追跡可能（Change/Auditログ）
  - 自動化: 変更反映のジョブ化・再試行・レート制御により安定運用

より詳しい背景・対象ユーザー・KPI・非ゴールは `docs/product/VALUE.md` を参照してください。

## 開発コマンド

- `make setup`: 開発に必要なツール/依存をインストール（ローカルで `corepack` / `npm` 使用）
 - `make dev`: ローカル開発サーバを起動（ポート `3014`、Nodeの`--watch`で自動再起動）
- `make test`: Node組み込みテストランナーで実行
- `make lint`: ESLint + Prettier チェック
- `make build`: dist 準備（現状はコピーのみ）
- `make gh-bootstrap` / `make gh-issues` / `make gh-milestones-order`: GitHub運用補助（要 `gh` とネットワーク）

### GitHubコメント運用（改行崩れ対策）
- 原則、本文はファイルで渡します（`--body-file`）。
- 例: `scripts/gh_comment.sh issue <番号> .github/comments/progress_rls_audit.md`
- PRコメント: `scripts/gh_comment.sh pr <番号> <本文ファイル>`
- Issueをコメント付きでクローズ: `scripts/gh_comment.sh issue-close <番号> <本文ファイル>`（コメント投稿→クローズの順）

## 環境変数

`.env.example` を `.env` にコピーし、必要な値を設定してください。秘密情報はコミットしないでください。

## ディレクトリ

- `src/` アプリ本体（ドメイン別: `src/auth/`, `src/core/` など）
- `tests/` テストコード（`src/` をミラー）
- `scripts/` 各種スクリプト（冪等に）
- `assets/`, `config/` 必要に応じて追加利用
- `.github/comments/` GitHubコメント用の本文テンプレ群（改行崩れ防止）

## サーバエンドポイント

- `GET /` ダッシュボードHTML（認証/トークン/保存状況の可視化、Refreshボタン）
- `GET /oauth/status` OAuthのステータス（スタブ）
- `GET /api/gbp/oauth` OAuth開始（スタブ応答）
- `GET /api/dashboard` ダッシュボード用の集約JSON（セッション・Supabaseの最新保存など）
- `GET /jobs` ジョブUIプレースホルダー

## 価値検証の最小縦切り（MVP）

初期フェーズでは、ユーザ価値の早期確認のため以下を最小構成で実装・検証します。

- OAuth連携 → ログイン状態の可視化（ダッシュボード）
- ロケーション一覧/詳細（まずはスタブ、次にDB接続）
- 変更申請→承認→反映（限定スコープ: 営業時間/電話/URL/説明）

マイルストーンとDone条件は `docs/product/MILESTONES.md` を参照してください。

## 追加ドキュメント（プロダクト）

- 利用シーン: `docs/product/USE_CASES.md`
- ワークフロー: `docs/product/WORKFLOWS.md`
- 価値定義: `docs/product/VALUE.md`
- KPI定義: `docs/product/KPIS.md`
- 計測仕様（順位・CV）: `docs/product/MEASUREMENT_SPEC.md`
- オペ運用/SLA/QA: `docs/product/OPS_QA.md`
- 価格とプラン（例）: `docs/product/PRICING.md`
- DDパッケージ（想定）: `docs/product/DD_PACKAGE.md`
- 営業テンプレ（参考）: `docs/product/SALES_TEMPLATES.md`
- コンプライアンス指針: `docs/product/COMPLIANCE.md`

## テスト

Node 22 の `node --test` を使用。`make test` で実行できます。
