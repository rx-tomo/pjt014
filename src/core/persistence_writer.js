import { create_change_request, set_status, set_status_and_reason, set_checks } from './change_requests_store.js';

let _ctx = {
  enqueueOutbox: null,
  supabaseEnabled: () => false,
  sbFetch: null,
};

export function initWriter(ctx) {
  _ctx.enqueueOutbox = ctx.enqueueOutbox;
  _ctx.supabaseEnabled = ctx.supabaseEnabled || (()=>false);
  _ctx.sbFetch = ctx.sbFetch || null;
}

export function createChangeRequestWrite(data, email) {
  const rec = create_change_request(data);
  try { rec.created_by_email = email || null; } catch {}
  if (_ctx.supabaseEnabled && _ctx.supabaseEnabled()) {
    _ctx.enqueueOutbox && _ctx.enqueueOutbox({ type: 'insert_change_request', data: {
      id: rec.id,
      location_id: rec.payload.location_id,
      changes: rec.payload.changes,
      status: rec.status,
      owner_signoff: Boolean(rec.payload.owner_signoff||false),
      created_by_email: email || null,
    }});
  }
  return rec;
}

export async function patchStatusWrite(id, st, reason) {
  let rec = reason ? set_status_and_reason(id, st, reason) : set_status(id, st);
  if (!rec) {
    if (_ctx.supabaseEnabled && _ctx.supabaseEnabled() && typeof _ctx.sbFetch === 'function') {
      const patch = Object.assign({}, { status: st }, (st==='needs_fix' && reason ? { review_note: reason } : {}));
      const r = await _ctx.sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(patch),
      }, 1200);
      if (!r.ok) return { ok: false, notFound: true };
      const arr = await r.json();
      rec = Array.isArray(arr) && arr[0] ? arr[0] : { id, status: st };
      return { ok: true, rec };
    }
    return { ok: false, notFound: true };
  } else {
    const patch = { status: st };
    if (st === 'needs_fix' && reason) patch.review_note = reason;
    _ctx.enqueueOutbox && _ctx.enqueueOutbox({ type: 'patch_change_request', id, patch });
    return { ok: true, rec };
  }
}

export async function patchChecksWrite(id, checks) {
  const rec = set_checks(id, checks || {});
  if (!rec) {
    if (_ctx.supabaseEnabled && _ctx.supabaseEnabled() && typeof _ctx.sbFetch === 'function') {
      const r = await _ctx.sbFetch(`/rest/v1/owner_change_requests?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ checks: checks || {} }),
      }, 1200);
      if (!r.ok) return { ok: false, notFound: true };
      return { ok: true };
    }
    return { ok: false, notFound: true };
  }
  _ctx.enqueueOutbox && _ctx.enqueueOutbox({ type: 'patch_change_request', id, patch: { checks: checks || {} } });
  return { ok: true };
}
