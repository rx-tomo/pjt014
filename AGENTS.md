# Language
ユーザとの対話は日本語で行うこと

# Repository Guidelines

## Project Structure & Module Organization
- Source lives in `src/`; public APIs grouped by domain. Example: `src/auth/`, `src/core/`.
- Tests in `tests/` mirroring `src/` paths. Example: `tests/auth/test_login.*`.
- Executable scripts in `scripts/` (bash or language-specific). Keep them idempotent.
- Static assets in `assets/`; configuration in `config/` or dotfiles at repo root.
- Current files: `init.txt` and VCS data in `.git/`. Create the folders above as needed.

## Build, Test, and Development Commands
- `make setup`: install tools/dependencies for local development.
- `make build`: compile or bundle the project (outputs to `dist/` or similar).
- `make test`: run unit/integration tests with coverage.
- `make lint`: run linters/formatters and fail on errors.
- `make dev`: start a local dev server on port `3014`.
If Make is unavailable, provide equivalents in `./scripts/` (e.g., `./scripts/test.sh`).

## Coding Style & Naming Conventions
- Indentation: 2 spaces; max line length: 100. Prefer explicit names over abbreviations.
- Files: `lower_snake_case.ext` for code, `kebab-case` for directories, `UPPER_SNAKE_CASE` for constants.
- Functions/methods: `lower_snake_case`; classes/types: `PascalCase`.
- Use a formatter and linter appropriate to the language; wire them to `make lint`.

## Testing Guidelines
- Place unit tests next to corresponding modules in `tests/`, mirroring paths.
- Test names: `test_<module>.<ext>` or `<name>.spec.<ext>`.
- Aim for ≥80% line/branch coverage. Run with `make test` or `./scripts/test.sh`.
- Include at least one integration test per domain (e.g., `tests/auth/`).

## Commit & Pull Request Guidelines
- Commits: use Conventional Commits, e.g., `feat(auth): add token refresh` or `fix(core): handle nil input`.
- Small, focused commits; include rationale in the body when non-obvious.
- PRs: clear description, link issues (`Closes #123`), include screenshots or logs when UI/CLI behavior changes.
- CI passing, `make lint` and `make test` green before review.

## Security & Configuration
- Never commit secrets. Use env files (`.env`) locally and add `.env.example` for required keys.
- Prefer parameterized config in `config/` and document defaults in README.

## Workflow & Issue Management
- Milestones: phase-based (`MVP`, `OAuth & Tokens`, `Supabase Schema`, `Worker & Jobs`, `Admin UI`, `Security & Compliance`).
- Issues: use templates under `.github/ISSUE_TEMPLATE/`（1課題=1Issue）。設計リンク/スクショを添付。
- Labels: `type:feat|bug|chore`, `area:api|ui|worker`, `priority:p0|p1|p2`。
- Flow: Issue作成 → PR紐付け（ドラフト可）→ スモールコミット → スクショ/ログ追記 → マージ時に `Closes #<id>` で自動クローズし、結果コメントを残す。
- Bootstrap: `make gh-bootstrap`（ラベル/マイルストーン作成）→ `make gh-issues`（代表Issue作成）。`gh` 認証とネットワークが必要。

## Handoff & Daily Logs (YAML)
以下のYAMLでセッションごとの進捗を最短記述。`docs/handoff/YYYY-MM-DD.yaml` に追記（1日1ファイル）。終了時に関連Issueへ要約コメントを残す。

```yaml
session: "2025-08-26/pm-1"   # 日付/任意の区分
who: "agent"                # 担当
milestone: "OAuth & Tokens"
issues: [10, 11, 12]         # 関連Issue番号
branch: "main"              # 作業ブランチ
env: { port: 3014, node: 22 }
changes:
  - add: app/oauth/status/page.tsx
  - update: app/api/jobs/gbp-patch/route.ts  # Zod
  - update: package.json                     # port=3014
  - docs: docs/gcp-oauth-setup.md
status: "running|blocked|done"
next:
  - setup GCP OAuth client and test callback
  - decide secure token storage approach
risks:
  - short-lived refresh tokens in test mode
notes: "短い補足があれば記載"
```
