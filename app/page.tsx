export default function Page() {
  return (
    <main className="space-y-4">
      <h1 className="text-2xl font-semibold">GBP 運用代行システム（MVP）</h1>
      <p>左上の <code>/api/gbp/oauth</code> から Google 連携の動作確認ができます。</p>
      <a className="underline" href="/api/gbp/oauth">Google に接続する</a>
      <div className="space-x-4 block pt-2">
        <a className="underline" href="/oauth/status">OAuth ステータス</a>
        <a className="underline" href="/jobs">ジョブ投入UI</a>
      </div>
    </main>
  );
}
