UI刷新: ブランドナビとプロモーショナルなランディング（Hero/CTA）

目的
- 実サービスを意識した第一印象と導線を整備し、役割別の主要導線（Owner/Review）をわかりやすく提示する。

実装内容
- グローバルナビ（ブランド名/主要リンク/ヘルスバー/Role切替）
- ランディングのHeroセクション（価値訴求・主要CTA）
- 価値ブロック（統制/安全/監査）と「使い分け」ガイド

受け入れ基準
- `/` にアクセスした際、HeroとCTAが表示され、Owner/Reviewへ1クリックで遷移できる
- ナビに Home/Locations/Owner/Review/Jobs/OAuth が並ぶ
- 右上に health (DB:on|off / Outbox:N) と Role 切替（Dev）が表示される

検証
- `make dev` → `/` → UI表示を確認
- Owner/Review/Locations への遷移が機能

備考
- MVPのままでも軽量に保つため、CSSはインライン/最小限。将来はデザインシステムへ移行

