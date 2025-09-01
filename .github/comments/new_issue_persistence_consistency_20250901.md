非同期保存の整合性: Supabase永続化のリトライと最終整合性

背景
- 送信/状態更新/チェック保存はUIハング防止のためfire-and-forget化した
- 短時間、メモリとSupabaseで不整合（未反映）が起こりうる

やること
- 保存タスクのリトライ/バックオフ（キュー）
- 同期状態の可視化（pending/synced/failed）
- 再同期API/ジョブ（failedの再送）
- 一貫性モデルの明示（at-least-once + 冪等設計）

完了条件
- ネットワーク断/遅延時でも最終的にSupabaseに反映される
- ユーザーへ pending→synced の状態が分かる

備考
- insert/patchの冪等性キー（id）と重複排除を確認

