import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM

function get_key() {
  const key = process.env.TOKEN_ENCRYPTION_KEY
    ? Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'base64')
    : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes base64');
  }
  return key;
}

export function encrypt(data: unknown): Buffer {
  const key = get_key();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const json = JSON.stringify(data);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]);
}

export function decrypt(payload: Buffer): unknown {
  const key = get_key();
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const text = payload.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(text), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}
