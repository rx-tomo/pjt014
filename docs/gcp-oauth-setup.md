# GCP OAuth Setup (Dev/Test)

この手順で Google OAuth (テストモード) を設定し、ローカルで `/api/gbp/oauth` → `/api/gbp/callback` の動作確認を行います。

## 1) OAuth 同意画面（テスト）
- 外部(External) で作成し、テストモードのままにする
- サポートメールを設定、スコープに以下を追加:
  - openid, email, profile
  - https://www.googleapis.com/auth/business.manage
- テストユーザーに自分のGoogleアカウントを追加

## 2) 認証情報（ウェブアプリ）
- クレデンシャルを作成 → OAuth クライアントID → 種類: ウェブアプリ
- 承認済みのリダイレクトURIに以下を追加:
  - http://localhost:3014/api/gbp/callback

## 3) .env.local を設定
```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3014/api/gbp/callback
```

## 4) 動作確認
- `make dev` を起動
- ブラウザ: `http://localhost:3014/oauth/status` で環境変数が緑表示であることを確認
- `http://localhost:3014/api/gbp/oauth` にアクセス → 認可 → `/api/gbp/callback` に `{ ok: true, tokens }`
  - `SUPABASE_DB_URL` が設定されていれば `persisted: true`（DBへ保存）となります

## 注意（テストモードの制約）
- テストユーザー最大100人
- 初回は「未確認アプリ」警告が出るが続行可能
- リフレッシュトークンは短命（概ね7日程度）
- Business Profile API の書き込みは審査が必要な場合あり（まずは読み取り/認可フローの確認から）
