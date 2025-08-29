# エージェント運用ガイド（GitHub/PR/Issue）

## 認証
- `gh auth status` で確認。`GH_TOKEN` が設定されている場合はそのトークンが使用される（通知メッセージは問題ではない）。
- キーチェーン保存に切り替える場合は `unset GH_TOKEN` → `gh auth login`。

## PR/Issue 本文の改行崩れ対策
- GH CLI は `--body` に渡した `\n` をそのまま表示する場合がある。
- 原則、本文はファイルで渡す。
  - 例: `gh pr create --base main --head <branch> --title "[Fix] ..." --body-file .github/pull_request_template.md`
  - 例: `gh issue comment <num> --body-file .github/comments/progress_example.md`

## マージ方針
- デフォルトは Squash Merge を推奨。
  - `gh pr merge --squash --auto <PR番号>`（ブランチ保護がある場合は承認後自動）
- 競合がある場合は `main` を取り込んで解消。
  - 迅速対応が必要なときは `-X ours`（feature優先）可。慎重ケースは手動解決。

## ブランチ/デプロイ
- Production Branch は `main`。マージ後に Vercel 自動デプロイ（該当プロジェクトの場合）。
- デプロイ後の簡易ヘルスチェック（例）
  - `/api/system-stats` → 200 + 件数返却
  - `/api/health-inspections` → 基本検索で非0
  - `/api/responses` → 非0

## 大容量ファイル
- `backup/**/*.sql`, `backup/**/*.dump` は .gitignore で除外。
- 誤コミット時は現行tipから削除（履歴の完全削除は BFG/filter-repo を検討）。

## gitして（Git add/commit/push の定型）
- 合言葉: 「gitして」
  - 全差分を追加 → コミット → 現在の追跡ブランチへ push。
  - コミットメッセージは日本語。省略時は `chore: 進捗のスナップショット`。

- バリエーション（言い方の例）
  - 「gitして『<メッセージ>』」または「gitして: <メッセージ>」
  - 「コミットだけして『<メッセージ>』」または「gitして（pushなし）『<メッセージ>』」
  - 「<ファイル/ディレクトリ> だけ gitして『<メッセージ>』」
  - 「push は不要」/「現在ブランチに push まで」

- デフォルト挙動（省略時）
  - `git status` と `git remote -v` を確認
  - `git add -A`
  - `git commit -m "<メッセージ>"`（未指定なら `chore: 進捗のスナップショット`）
  - `git push`（追跡ブランチへ）

- 前提/注意
  - 追跡ブランチ未設定時は `git push --set-upstream origin <current-branch>` を提案・確認。
  - 認証は SSH または GH_TOKEN/PAT。必要に応じて承認プロンプトあり。
  - `.env` など秘匿ファイルは `.gitignore` で除外。除外したいものがあれば「ただし <path> は除外」と指示。

- 具体例
  - 「gitして」 → `chore: 進捗のスナップショット`
  - 「gitして『スタイル修正の途中』」 → `chore: スタイル修正の途中`
  - 「この3ファイルだけ gitして『一時保存』: app/page.tsx lib/ui/button.ts src/hooks/useFoo.ts」
  - 「コミットだけして『WIP: ルーティング調整』」 → push なし
