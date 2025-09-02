// Minimal channel-agnostic notifier. Provider is selected by env.

function provider() {
  const v = String(process.env.NOTIFY_PROVIDER || '').toLowerCase();
  if (!v) return 'none';
  if (['none','console','webhook'].includes(v)) return v;
  return 'none';
}

export async function notify(evt) {
  try {
    const p = provider();
    const payload = Object.assign({ ts: new Date().toISOString() }, evt || {});
    if (p === 'none') return { ok: true, delivered: false, provider: p };
    if (p === 'console') {
      try { console.log('[notify]', JSON.stringify(payload)); } catch {}
      return { ok: true, delivered: true, provider: p };
    }
    if (p === 'webhook') {
      const url = process.env.NOTIFY_WEBHOOK_URL || '';
      if (!url) return { ok: false, error: 'missing_webhook_url' };
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { ok: r.ok, status: r.status, provider: p };
    }
    return { ok: false, error: 'unsupported_provider' };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

export function buildChangeRequestNotification({ action, request, reason }) {
  const subject = action === 'needs_fix'
    ? '変更依頼が差戻しになりました'
    : action === 'approved'
      ? '変更依頼が承認されました'
      : `変更依頼の更新: ${action}`;
  const body = {
    id: request?.id,
    location_id: request?.payload?.location_id || request?.location_id || null,
    status: request?.status,
    reason: reason || null,
  };
  return { channel: 'change_request', subject, body };
}

