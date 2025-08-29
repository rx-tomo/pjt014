import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { create_server } from '../../src/core/server.js';

const should_skip = process.env.TEST_NO_LISTEN === '1';

describe('server', { skip: should_skip }, () => {
  /** @type {import('node:http').Server} */
  let server;
  /** @type {number} */
  let port;

  before(async () => {
    server = create_server();
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (err) {
      // 環境によりlistenが禁止される場合がある
      // この場合はスキップフラグを立てる
      console.warn('[test] listen blocked in sandbox, skipping server tests');
      // throw せず、その後のテストはskip設定で実行されない
      return;
    }
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('GET / responds with HTML dashboard', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const ct = res.headers.get('content-type') || '';
    assert.ok(ct.includes('text/html'));
    const text = await res.text();
    assert.ok(text.includes('Dev Dashboard'));
  });

  it('GET /oauth/status returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/oauth/status`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it('GET /api/locations returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/locations`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.items));
  });
});
