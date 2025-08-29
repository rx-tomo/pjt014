## 進捗更新: Compliance UI（NG辞書・チェック保存・owner_signoff）

実装済み（dev/mainに反映済み）

- NG辞書の外部化: `config/compliance_rules.json` を読み込み（無い場合はデフォルトにフォールバック）
- 依頼作成API: `POST /api/change-requests` に `owner_signoff` を追加（UIから送信）
- レビュー保存API: `POST /api/change-requests/:id/checks` と `POST /api/change-requests/:id/status` を Supabase にも反映（有効時）
- レビュー画面: `checks` の初期反映と `owner_signoff` 表示を追加
- 重複していた `POST /api/compliance-check` ハンドラを1つに整理
- DB: `owner_change_requests` に `checks jsonb`, `owner_signoff boolean default false` を追加（migration 0007）

コミット

- 9766712: feat(compliance): NG辞書外部化・チェック/ステータス保存・owner_signoff追加
- e05ef8f: docs: READMEに変更依頼APIとNG辞書設定を追記

簡易検証手順

1. `npm run dev`（ポート 3014）
2. Owner Portal で説明にNG語を入れて自動チェックが表示されることを確認
3. `owner_signoff` にチェック→送信→ `/review` に表示
4. `/review/:id` で `checks` を保存→再読込で反映／`approved` 等にステータス更新
5. Supabase有効時は `owner_change_requests` に `checks` と `owner_signoff` が保存/更新されることを確認

残タスク（提案）

- [ ] `owner_signoff` 未チェック時はサーバ側で 400（必須化）
- [ ] `/review` と `/review/:id` のローディング・空状態・エラー表示の強化
- [ ] 最小のチェックルールの追加（例: URL/電話の形式）
- [ ] RLS/監査の運用ノート整備（レビュー操作の権限制御）

問題なければ、このIssueのDone条件に沿って上記の残タスクも続けて対応します。

