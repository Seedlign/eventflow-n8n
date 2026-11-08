import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { loadModules } from '../scripts/lib/modules.mjs';

const { sha256Hex, hmacSha256Hex, makeToken, makeVerificationId } = loadModules(['sha256', 'tokens']);

test('sha256 matches node crypto, including multi-block and unicode input', () => {
  for (const s of ['', 'abc', 'x'.repeat(200), 'Niño Ñañez']) {
    assert.equal(sha256Hex(s), createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('hmac matches node crypto, including keys longer than one block', () => {
  for (const key of ['secret', 'k'.repeat(100)]) {
    assert.equal(hmacSha256Hex(key, 'REG-8001'), createHmac('sha256', key).update('REG-8001').digest('hex'));
  }
});

test('token is N8NPH- plus 8 uppercase hex, stable per user and secret', () => {
  const t = makeToken('s', 'REG-8001');
  assert.match(t, /^N8NPH-[0-9A-F]{8}$/);
  assert.equal(makeToken('s', 'REG-8001'), t);
  assert.notEqual(makeToken('s', 'REG-8002'), t);
  assert.notEqual(makeToken('other', 'REG-8001'), t);
});

test('verification id changes if any signed field changes', () => {
  const v = makeVerificationId('s', 'REG-8001', 'N8NPH-AAAAAAAA', '2026-11-08');
  assert.match(v, /^VER-[0-9A-F]{12}$/);
  assert.notEqual(makeVerificationId('s', 'REG-8001', 'N8NPH-AAAAAAAB', '2026-11-08'), v);
  assert.notEqual(makeVerificationId('s', 'REG-8001', 'N8NPH-AAAAAAAA', '2026-11-09'), v);
});
