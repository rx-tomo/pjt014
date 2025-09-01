CI整備: lint/testの自動実行と保護ルール

目的
- mainへの変更を安定化（lint/test自動化、保護ルール）

やること
- GitHub Actions: node 22で npm ci → lint → test 実行
- PR必須・squash merge の徹底、必須チェックの設定
- 開発者向けガイドの追記（README/AGENTS.md）

完了条件
- PRにてCIが走り、failでマージ不可

