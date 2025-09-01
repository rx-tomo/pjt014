テスト追加: APIルート/画面フローの自動テスト

対象
- API: /api/change-requests (POST/GET), /status, /checks, /compliance-check
- 画面: Owner送信→一覧反映、Review詳細→チェック保存/状態更新（最小）

方針
- node --test を用いたHTTPレベルのテスト（既存 tests/core/test_server.js を拡張）
- Supabase未設定でも通るケース中心（スタブ）

完了条件
- 主要フローのテストがCIで緑

