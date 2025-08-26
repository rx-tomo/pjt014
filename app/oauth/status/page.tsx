export default function OAuthStatusPage() {
  const required = [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'GOOGLE_OAUTH_REDIRECT_URI'
  ] as const;

  const present = required.map((k) => ({ key: k, ok: Boolean(process.env[k]) }));

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-semibold">Google OAuth ステータス</h1>
      <p>必要な環境変数の設定状況を表示します。未設定がある場合は <code>.env.local</code> を更新してください。</p>
      <ul className="space-y-1">
        {present.map((p) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${p.ok ? 'bg-green-500' : 'bg-red-500'}`} />
            <code>{p.key}</code>
          </li>
        ))}
      </ul>
      <div>
        <a className="underline" href="/api/gbp/oauth">/api/gbp/oauth へ進む</a>
      </div>
      <p className="text-sm text-gray-600">リダイレクトURIは <code>http://localhost:3014/api/gbp/callback</code> を Google Cloud のOAuthクライアントに登録してください。</p>
    </main>
  );
}
