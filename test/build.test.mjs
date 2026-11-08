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
  assert.equal(cert.binary.certificate.mimeType, 'application/pdf');
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

const notionConfig = { ...config, notion: { attendeesDb: 'db-att', logDb: 'db-log' } };
const nwf = buildWorkflow(notionConfig);
const nnode = name => nwf.nodes.find(n => n.name === name);

test('notion nodes are only built when both database ids are configured', () => {
  assert.equal(node('Read Notion Attendees'), undefined);
  assert.equal(buildWorkflow({ ...config, notion: { attendeesDb: 'x' } }).nodes.some(n => n.type === 'n8n-nodes-base.notion'), false);
  assert.equal(nnode('Read Notion Attendees').parameters.databaseId.value, 'db-att');
  const settings = nnode('Event Settings').parameters.assignments.assignments;
  assert.equal(settings.find(a => a.name === 'notion_log_db').value, 'db-log');
});

test('notion branches hang off the summary and the log write and every connection is real', () => {
  const next = name => nwf.connections[name].main[0].map(c => c.node);
  assert.deepEqual(next('Funnel Summary'), ['Read Notion Attendees']);
  assert.deepEqual(next('Read Notion Attendees'), ['Plan Notion Sync']);
  assert.deepEqual(next('Plan Notion Sync'), ['Sync Notion Attendee']);
  assert.deepEqual(next('Append Event Log'), ['Plan Notion Log']);
  assert.deepEqual(next('Plan Notion Log'), ['Append Notion Log']);
  const names = new Set(nwf.nodes.map(n => n.name));
  for (const { main } of Object.values(nwf.connections)) for (const out of main) for (const c of out) assert.ok(names.has(c.node), c.node);
  for (const n of ['Read Notion Attendees', 'Sync Notion Attendee', 'Append Notion Log']) assert.equal(nnode(n).onError, 'continueRegularOutput', n);
});

// fake $ for the notion glue: Event Settings plus the router's attendee (0) and log (1) outputs
const routed = { 0: [{ json: { action: 'attendee', user_id: 'REG-8001', full_name: 'Juancho', status: 'Attended' } }], 1: [{ json: { action: 'log', log_id: 'r#1', sequence: 1, event_type: 'checkin_scanned', outcome: 'OK' } }] };
const $n = name => name === 'Event Settings'
  ? { first: () => ({ json: { notion_attendees_db: 'db-att', notion_log_db: 'db-log' } }) }
  : name === 'Read Attendees' ? { all: () => [{ json: {} }] } : { all: branch => routed[branch] };

test('plan notion sync node creates or updates from the database read', () => {
  const runSync = pages => new Function('$', '$input', nnode('Plan Notion Sync').parameters.jsCode)($n, { all: () => pages.map(json => ({ json })) });
  assert.equal(runSync([{}])[0].json.method, 'POST');
  assert.equal(runSync([{ id: 'p1', property_user_id: 'REG-8001' }])[0].json.url, 'https://api.notion.com/v1/pages/p1');
  assert.deepEqual(runSync([{ error: 'unauthorized' }]), []);
});

test('plan notion log node turns each routed log row into a page', () => {
  const out = new Function('$', '$input', nnode('Plan Notion Log').parameters.jsCode)($n, { all: () => [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].json.body.parent.database_id, 'db-log');
});

test('notion requests send the API version and pace themselves', () => {
  const p = nnode('Sync Notion Attendee').parameters;
  assert.equal(p.nodeCredentialType, 'notionApi');
  assert.deepEqual(p.headerParameters.parameters, [{ name: 'Notion-Version', value: '2022-06-28' }]);
  assert.ok(p.options.batching.batch.batchInterval >= 334);
});
