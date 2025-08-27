import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse_cookies, sign_value, verify_value } from '../../src/core/cookies.js';

describe('cookies utils', () => {
  it('parses cookie header', () => {
    const obj = parse_cookies('a=1; b=hello%20world');
    assert.equal(obj.a, '1');
    assert.equal(obj.b, 'hello world');
  });

  it('signs and verifies values', () => {
    const secret = 'test_secret';
    const signed = sign_value('payload', secret);
    const ok = verify_value(signed, secret);
    assert.equal(ok, 'payload');
    const bad = verify_value(signed + 'x', secret);
    assert.equal(bad, null);
  });
});

