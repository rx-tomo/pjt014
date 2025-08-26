'use client';

import { useState } from 'react';

export default function JobsPage() {
  const [accessToken, setAccessToken] = useState('');
  const [locationName, setLocationName] = useState('accounts/123/locations/456');
  const [updateMask, setUpdateMask] = useState('profile.description');
  const [data, setData] = useState('{
  "profile": { "description": "New description" }
}');
  const [result, setResult] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    try {
      const res = await fetch('/api/jobs/gbp-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken,
          locationName,
          updateMask,
          data: JSON.parse(data)
        })
      });
      const json = await res.json();
      setResult(JSON.stringify(json, null, 2));
    } catch (err: any) {
      setResult(String(err?.message || err));
    }
  }

  return (
    <main className="space-y-6">
      <h1 className="text-2xl font-semibold">GBP パッチジョブ投入</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Access Token</label>
          <input className="w-full border p-2" value={accessToken} onChange={e => setAccessToken(e.target.value)} placeholder="ya29...." />
        </div>
        <div>
          <label className="block text-sm font-medium">Location Name</label>
          <input className="w-full border p-2" value={locationName} onChange={e => setLocationName(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium">Update Mask (comma-separated)</label>
          <input className="w-full border p-2" value={updateMask} onChange={e => setUpdateMask(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium">Request Body (JSON)</label>
          <textarea className="w-full border p-2 font-mono" rows={8} value={data} onChange={e => setData(e.target.value)} />
        </div>
        <button type="submit" className="px-4 py-2 bg-black text-white">Enqueue</button>
      </form>
      {result && (
        <pre className="bg-gray-50 p-4 border overflow-auto text-sm">{result}</pre>
      )}
    </main>
  );
}

