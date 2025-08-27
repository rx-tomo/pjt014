import crypto from 'node:crypto';

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let jwksCache = { keys: [], fetchedAt: 0 };

async function fetch_json(url) {
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`fetch ${url} failed: ${r.status}`);
  return r.json();
}

export async function get_google_jwks({ force = false } = {}) {
  const now = Date.now();
  if (!force && jwksCache.keys.length && now - jwksCache.fetchedAt < 10 * 60 * 1000) {
    return jwksCache;
  }
  const data = await fetch_json(JWKS_URL);
  jwksCache = { keys: data.keys || [], fetchedAt: now };
  return jwksCache;
}

function base64urlDecode(input) {
  return Buffer.from(input, 'base64url');
}

export function decode_jwt(jwt) {
  const [h, p, s] = String(jwt).split('.');
  if (!h || !p || !s) throw new Error('invalid_jwt');
  const header = JSON.parse(base64urlDecode(h).toString('utf8'));
  const payload = JSON.parse(base64urlDecode(p).toString('utf8'));
  const signature = base64urlDecode(s);
  return { header, payload, signature, signingInput: `${h}.${p}` };
}

export async function verify_google_id_token(idToken, { audience, nonce }) {
  const { header, payload, signature, signingInput } = decode_jwt(idToken);
  if (header.alg !== 'RS256') throw new Error('unsupported_alg');
  const { keys } = await get_google_jwks();
  const jwk = keys.find((k) => k.kid === header.kid && k.alg === 'RS256');
  if (!jwk) throw new Error('jwk_not_found');

  // Node.jsはJWK形式の公開鍵を受け付ける
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  const ok = verifier.verify(publicKey, signature);
  if (!ok) throw new Error('invalid_signature');

  const now = Math.floor(Date.now() / 1000);
  // iss/aud/exp/nonce チェック
  const validIss = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  if (!validIss) throw new Error('invalid_iss');
  if (audience && payload.aud !== audience) throw new Error('invalid_aud');
  if (payload.exp && payload.exp < now) throw new Error('token_expired');
  if (nonce && payload.nonce !== nonce) throw new Error('invalid_nonce');
  return payload;
}

