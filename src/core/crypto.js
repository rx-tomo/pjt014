import crypto from 'node:crypto';

function get_key(secret) {
  // Derive 32-byte key via scrypt
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, 'pjt014_salt', 32, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function aes_gcm_encrypt(plaintext, secret) {
  const key = await get_key(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

export async function aes_gcm_decrypt(payload, secret) {
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  const key = await get_key(secret);
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const data = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}

