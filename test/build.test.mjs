import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorkflow } from '../scripts/build-workflow.mjs';

const config = { sheetId: 'SHEET', demoRecipient: 'me@gmail.com', secret: 'test-secret', eventName: 'n8n PH Buildathon' };
const wf = buildWorkflow(config);
const node = name => wf.nodes.find(n => n.name === name);
const batch = JSON.parse(readFileSync(new URL('../fixtures/trackd-batch.json', import.meta.url), 'utf8'));

test('required nodes are present', () => {
  const types = new Set(wf.nodes.map(n => n.type));
  for (const t of ['n8n-nodes-base.httpRequest', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.code', 'n8n-nodes-base.gmail', 'n8n-nodes-base.webhook']) {
    assert.ok(types.has(t), t);
  }
});

test('organizer HTTP Request node is GET TrackDData as the brief specifies', () => {
  const http = wf.nodes.find(n => n.type === 'n8n-nodes-base.httpRequest');
  assert.equal(http.parameters.method, 'GET');
  assert.equal(http.parameters.url, 'https://khylepanganiban.app.n8n.cloud/webhook/TrackDData');
});

test('every connection points at a real node', () => {
  const names = new Set(wf.nodes.map(n => n.name));
  for (const [src, { main }] of Object.entries(wf.connections)) {
    assert.ok(names.has(src), src);
    for (const out of main) for (const c of out) assert.ok(names.has(c.node), c.node);
  }
});

// runs the generated Code node body the way n8n would, against the real batch
test('engine Code node emits rows, log, emails and a summary', () => {
  const settings = { ...batch, event_name: config.eventName, demo_recipient: config.demoRecipient, secret: config.secret, verify_base_url: 'https://x/' };
  const $ = name => { assert.equal(name, 'Event Settings'); return { first: () => ({ json: settings }) }; };
  const $input = { all: () => [{ json: {} }] };
  const out = new Function('$', '$input', node('Run Lifecycle Engine').parameters.jsCode)($, $input);
  const count = a => out.filter(i => i.json.action === a).length;
  assert.deepEqual([count('attendee'), count('log'), count('entry_pass'), count('certificate'), count('summary')], [5, 15, 5, 4, 1]);
  const cert = out.find(i => i.json.action === 'certificate');
  assert.equal(cert.binary.certificate.mimeType, 'text/html');
  assert.ok(out.filter(i => i.json.action === 'entry_pass').every(i => i.json.to === 'me@gmail.com'));
});

test('live webhook glue wraps one event as a batch', () => {
  const out = new Function('$json', node('Wrap Live Event').parameters.jsCode)({ body: { event_type: 'checkin_scanned', user_id: 'REG-8005' } });
  assert.equal(out.json.raw_incoming_payloads[0].sequence, 1);
  assert.equal(out.json.raw_incoming_payloads[0].user_id, 'REG-8005');
});

test('switch has one output per action and each reaches its writer', () => {
  const outs = wf.connections['Route by Action'].main.map(o => o[0].node);
  assert.deepEqual(outs, ['Upsert Attendee', 'Append Event Log', 'Send Entry Pass', 'Send Certificate', 'Funnel Summary']);
});
