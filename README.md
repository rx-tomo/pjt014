# pjt014

開発用の最小構成をセットアップしました。Node.js (>=22) で動作する軽量HTTPサーバ、テスト、Lint/Format、各種スクリプト、Issueテンプレート等を含みます。

## 開発コマンド

- `make setup`: 開発に必要なツール/依存をインストール（ローカルで `corepack` / `npm` 使用）
- `make dev`: ローカル開発サーバを起動（ポート `3014`）
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

## テスト

Node 22 の `node --test` を使用。`make test` で実行できます。
