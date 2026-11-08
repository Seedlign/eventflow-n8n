import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../scripts/lib/modules.mjs';

const { renderEmail, escapeHtml } = loadModules(['templates']);
const settings = { event_name: 'n8n PH Buildathon', verify_base_url: 'https://credentials.n8n.ph/verify/' };
const a = {
  user_id: 'REG-8001', full_name: 'Juancho <b>Santos</b>', email: 'j@dummymail.ph', token: 'N8NPH-1A2B3C4D',
  project_name: 'Alert Dispatcher', completed_at: '2026-11-08T15:30:10Z', verification_id: 'VER-ABCDEF123456',
};

test('escapeHtml neutralises markup in attendee text', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('entry pass shows the token as text and as a QR image', () => {
  const m = renderEmail({ kind: 'entry_pass', to: 'me@x', original_email: a.email, attendee: a }, settings);
  assert.match(m.subject, /entry pass/i);
  assert.ok(m.html.includes('N8NPH-1A2B3C4D'));
  assert.ok(m.html.includes('api.qrserver.com') && m.html.includes(encodeURIComponent('N8NPH-1A2B3C4D')));
  assert.ok(m.html.includes('Juancho &lt;b&gt;Santos&lt;/b&gt;'));
  assert.ok(m.html.includes(a.email), 'original address stays visible under a demo override');
  assert.equal(m.attachment, null);
});

test('certificate is an HTML attachment with name, date and verification id', () => {
  const m = renderEmail({ kind: 'certificate', to: 'me@x', original_email: a.email, attendee: a }, settings);
  assert.equal(m.attachment.fileName, 'certificate-REG-8001.html');
  assert.equal(m.attachment.mimeType, 'text/html');
  const doc = Buffer.from(m.attachment.base64, 'base64').toString('utf8');
  for (const s of ['Juancho &lt;b&gt;Santos&lt;/b&gt;', 'November 8, 2026', 'VER-ABCDEF123456', 'Alert Dispatcher', 'https://credentials.n8n.ph/verify/VER-ABCDEF123456']) {
    assert.ok(doc.includes(s), s);
  }
  assert.ok(m.html.includes('VER-ABCDEF123456'));
});
