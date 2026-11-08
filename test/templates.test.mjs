import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadModules } from '../scripts/lib/modules.mjs';

const { renderEmail, escapeHtml, pdfText, verificationPage, longDate, shortStamp } = loadModules(['pdf', 'templates']);
const settings = { event_name: 'n8n PH Buildathon', verify_base_url: 'https://eventflow.app.n8n.cloud/webhook/verify?id=' };
const a = {
  user_id: 'REG-8001', full_name: 'Juancho <b>Santos</b>', email: 'j@dummymail.ph', token: 'N8NPH-1A2B3C4D',
  project_name: 'Alert Dispatcher', registered_at: '2026-11-08T09:00:00Z', checked_in_at: '2026-11-08T10:15:12Z',
  completed_at: '2026-11-08T15:30:10Z', verification_id: 'VER-ABCDEF123456',
};
const cert = renderEmail({ kind: 'certificate', to: 'me@x', original_email: a.email, attendee: a }, settings);
const pdf = Buffer.from(cert.attachment.base64, 'base64').toString('latin1');

test('escapeHtml neutralises markup in attendee text', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('pdf text escapes delimiters and drops characters standard fonts cannot draw', () => {
  assert.equal(pdfText('a(b)\\c'), 'a\\(b\\)\\\\c');
  assert.equal(pdfText('Niño 漢'), 'Niño ?');
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

test('certificate is a PDF attachment', () => {
  assert.equal(cert.attachment.fileName, 'certificate-REG-8001.pdf');
  assert.equal(cert.attachment.mimeType, 'application/pdf');
  assert.ok(pdf.startsWith('%PDF-1.4') && pdf.trimEnd().endsWith('%%EOF'));
});

test('pdf carries name, date, verification id, project and the three lifecycle stamps', () => {
  for (const s of ['Juancho <b>Santos</b>', 'November 8, 2026', 'VER-ABCDEF123456', 'Alert Dispatcher',
    'eventflow.app.n8n.cloud', '/webhook/verify?id=VER-ABCDEF123456', 'Nov 8, 17:00 PHT', 'Nov 8, 18:15 PHT', 'Nov 8, 23:30 PHT']) {
    assert.ok(pdf.includes(s), s);
  }
});

test('pdf xref offsets point at their objects', () => {
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.ok(pdf.slice(xref).startsWith('xref'));
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((o, i) => assert.ok(pdf.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1}`));
});

test('certificate email names the verification id', () => {
  assert.ok(cert.html.includes('VER-ABCDEF123456'));
});

test('certificate email links to the public verification page', () => {
  assert.ok(cert.html.includes('href="https://eventflow.app.n8n.cloud/webhook/verify?id=VER-ABCDEF123456"'));
});

test('verification page vouches for an issued credential with name, project and date', () => {
  const page = verificationPage({ ...a, status: 'Completed' }, 'VER-ABCDEF123456', 'n8n PH Buildathon');
  assert.equal(page.valid, true);
  for (const s of ['Valid credential', 'Juancho &lt;b&gt;Santos&lt;/b&gt;', 'Alert Dispatcher', 'November 8, 2026', 'VER-ABCDEF123456', 'n8n PH Buildathon']) {
    assert.ok(page.html.includes(s), s);
  }
});

test('verification page refuses an unknown id without echoing raw markup', () => {
  const page = verificationPage(null, '<script>x</script>', 'n8n PH Buildathon');
  assert.equal(page.valid, false);
  assert.ok(page.html.includes('Not a valid credential'));
  assert.ok(!page.html.includes('<script>x') && page.html.includes('&lt;script&gt;x'));
});

test('dates print in Manila time', () => {
  assert.equal(longDate('2026-11-08T16:30:00Z'), 'November 9, 2026');
  assert.equal(shortStamp('2026-11-08T16:30:00Z'), 'Nov 9, 00:30 PHT');
  assert.equal(shortStamp('2026-11-08T01:05:00Z'), 'Nov 8, 09:05 PHT');
  assert.equal(longDate('2026-11-08T23:30:00.000+08:00'), 'November 8, 2026');
  assert.equal(longDate('not a date'), '');
});

test('verification page shows the Manila completion date', () => {
  const page = verificationPage({ ...a, status: 'Completed', completed_at: '2026-11-08T16:30:00Z' }, 'VER-ABCDEF123456', 'x');
  assert.ok(page.html.includes('November 9, 2026'));
});

test('certificate also carries an SVG badge with escaped name, date and verification id', () => {
  assert.equal(cert.badge.fileName, 'badge-REG-8001.svg');
  assert.equal(cert.badge.mimeType, 'image/svg+xml');
  const svg = Buffer.from(cert.badge.base64, 'base64').toString('utf8');
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  for (const s of ['VERIFIED FINISHER', 'Juancho &lt;b&gt;Santos&lt;/b&gt;', 'November 8, 2026', 'VER-ABCDEF123456', 'n8n PH Buildathon']) {
    assert.ok(svg.includes(s), s);
  }
  assert.ok(!svg.includes('<b>Santos'));
});
