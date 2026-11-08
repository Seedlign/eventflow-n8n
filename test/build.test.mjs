import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildWorkflow, redact } from '../scripts/build-workflow.mjs';

const config = { sheetId: 'SHEET', demoRecipient: 'me@gmail.com', secret: 'test-secret', eventName: 'n8n PH Buildathon', n8nBaseUrl: 'https://eventflow.app.n8n.cloud/' };
const wf = buildWorkflow(config);
const node = name => wf.nodes.find(n => n.name === name);
const outputs = name => wf.connections[name].main.map(o => o.map(c => c.node));
const batch = JSON.parse(readFileSync(new URL('../fixtures/trackd-batch.json', import.meta.url), 'utf8'));
const settingValue = name => node('Event Settings').parameters.assignments.assignments.find(a => a.name === name).value;

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
  assert.deepEqual(outputs('Route by Action').map(o => o[0]),
    ['Upsert Attendee', 'Append Event Log', 'Send Entry Pass', 'Send Certificate', 'Append Funnel Snapshot']);
});

// --- email delivery is recorded only when Gmail succeeds

test('a failed Gmail send goes to the error output instead of being recorded as sent', () => {
  for (const [gmail, record, column] of [['Send Entry Pass', 'Record Pass Sent', 'pass_sent_at'], ['Send Certificate', 'Record Certificate Sent', 'certificate_sent_at']]) {
    assert.equal(node(gmail).onError, 'continueErrorOutput', gmail);
    assert.deepEqual(outputs(gmail)[0], [record], gmail);
    const p = node(record).parameters;
    assert.equal(p.operation, 'appendOrUpdate');
    assert.equal(p.sheetName.value, 'Attendees');
    assert.deepEqual(p.columns.matchingColumns, ['user_id']);
    assert.deepEqual(Object.keys(p.columns.value).sort(), [column, 'user_id'].sort(), record);
    assert.match(p.columns.value.user_id, /\$\('Route by Action'\)\.item\.json\.user_id/);
  }
});

test('delivery stamps run after the attendee upsert, so the upsert cannot blank them', () => {
  const y = name => node(name).position[1];
  assert.ok(y('Upsert Attendee') < y('Send Entry Pass') && y('Upsert Attendee') < y('Send Certificate'));
});

// --- the live webhook answers the scanner with the verdict

test('live webhook replies through a Respond node fed by the summary, batch runs do not', () => {
  assert.equal(node('Live Event').parameters.responseMode, 'responseNode');
  const cond = node('From Live Webhook?').parameters.conditions.conditions[0];
  assert.equal(cond.leftValue, '={{ $json.source }}');
  assert.equal(cond.rightValue, 'webhook');
  assert.deepEqual(outputs('From Live Webhook?'), [['Reply to Scanner'], ['Funnel Summary']]);
  assert.equal(node('Reply to Scanner').type, 'n8n-nodes-base.respondToWebhook');
  assert.equal(node('Reply to Scanner').parameters.respondWith, 'firstIncomingItem');
});

// --- public verification endpoint behind the link printed on every certificate

test('certificates point at this instance\'s verify webhook', () => {
  assert.equal(settingValue('verify_base_url'), 'https://eventflow.app.n8n.cloud/webhook/verify?id=');
  const hook = node('Verify Credential');
  assert.equal(hook.type, 'n8n-nodes-base.webhook');
  assert.equal(hook.parameters.httpMethod, 'GET');
  assert.equal(hook.parameters.path, 'verify');
  assert.equal(hook.parameters.responseMode, 'responseNode');
  assert.deepEqual(outputs('Verify Credential'), [['Read Credentials']]);
  assert.deepEqual(outputs('Read Credentials'), [['Render Verification']]);
  assert.deepEqual(outputs('Render Verification'), [['Reply with Verification']]);
  assert.equal(node('Reply with Verification').parameters.respondWith, 'text');
});

test('verify Code node renders a page from the sheet rows and the query id', () => {
  const run = (id, rows) => {
    const $ = name => { assert.equal(name, 'Verify Credential'); return { first: () => ({ json: { query: { id } } }) }; };
    const $input = { all: () => rows.map(json => ({ json })) };
    return new Function('$', '$input', node('Render Verification').parameters.jsCode)($, $input)[0].json;
  };
  const row = { user_id: 'U1', full_name: 'Juancho Santos', status: 'Completed', verification_id: 'VER-ABC', project_name: 'P', completed_at: '2026-11-08T15:30:10Z' };
  const ok = run('VER-ABC', [row]);
  assert.equal(ok.valid, true);
  assert.ok(ok.html.includes('Juancho Santos') && ok.html.includes('n8n PH Buildathon'));
  assert.equal(run('VER-NOPE', [row]).valid, false);
  assert.equal(run(undefined, [{}]).valid, false);
});

const runEngine = settings => new Function('$', '$input', node('Run Lifecycle Engine').parameters.jsCode)(() => ({ first: () => ({ json: settings }) }), { all: () => [{ json: {} }] });

test('certificate Gmail node attaches both the PDF and the badge', () => {
  assert.equal(node('Send Certificate').parameters.options.attachmentsUi.attachmentsBinary[0].property, 'certificate,badge');
  const cert = runEngine({ ...batch, event_name: 'x', secret: 's', demo_recipient: '' }).find(i => i.json.action === 'certificate');
  assert.equal(cert.binary.badge.mimeType, 'image/svg+xml');
});

test('form glue turns a submission into a one-event registration batch', () => {
  const out = new Function('$json', node('Wrap Form Entry').parameters.jsCode)({
    'Full name': 'Ana Reyes', Email: 'ana@x.ph', Organization: 'PUP', Role: '', submittedAt: '2026-11-08T09:00:00.000+08:00' });
  assert.equal(out.json.processing_batch_metadata.source, 'form');
  assert.deepEqual(out.json.raw_incoming_payloads, [{ sequence: 1, event_type: 'registration_submitted', full_name: 'Ana Reyes',
    email: 'ana@x.ph', organization: 'PUP', role: '', timestamp: '2026-11-08T09:00:00.000+08:00' }]);
  assert.equal(node('Registration Form').type, 'n8n-nodes-base.formTrigger');
  assert.deepEqual(outputs('Registration Form'), [['Wrap Form Entry']]);
  assert.deepEqual(outputs('Wrap Form Entry'), [['Event Settings']]);
});

test('every run appends one flat funnel row, zeros included', () => {
  const s = runEngine({ processing_batch_metadata: { source: 'webhook' }, raw_incoming_payloads: [{ sequence: 1, event_type: 'party' }], secret: 's' })
    .find(i => i.json.action === 'summary').json;
  assert.deepEqual([s.registered, s.ok, s.invalid, s.duplicate, s.unverified, s.retries], [0, 0, 1, 0, 0, 0]);
  assert.deepEqual([...outputs('Route by Action')[4]].sort(), ['Append Funnel Snapshot', 'From Live Webhook?']);
  assert.equal(node('Append Funnel Snapshot').parameters.sheetName.value, 'Funnel');
  assert.ok(node('Append Funnel Snapshot').position[1] < node('From Live Webhook?').position[1]);
});

test('live webhook requires header auth', () => {
  assert.equal(node('Live Event').parameters.authentication, 'headerAuth');
});

test('live glue accepts a bare array of events', () => {
  const out = new Function('$json', node('Wrap Live Event').parameters.jsCode)({ body: [{ event_type: 'checkin_scanned', token: 'A' }, { event_type: 'checkin_scanned', token: 'B' }] });
  assert.deepEqual(out.json.raw_incoming_payloads.map(e => [e.sequence, e.token]), [[1, 'A'], [2, 'B']]);
});

test('submission export carries no secret, sheet id or demo inbox and leaves the original intact', () => {
  const cfg = { ...config, sheetId: 'SHEET-ID-123', secret: 'sekret-abc-987' };
  const built = buildWorkflow(cfg);
  const out = JSON.stringify(redact(built, cfg));
  for (const v of [cfg.secret, cfg.sheetId, cfg.demoRecipient]) assert.ok(!out.includes(v), v);
  assert.ok(out.includes('REPLACE_SECRET') && out.includes('REPLACE_SHEET_ID'));
  assert.ok(JSON.stringify(built).includes(cfg.secret));
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

test('live webhook calls also sync Notion, after the scanner has its reply', () => {
  assert.deepEqual(nwf.connections['Reply to Scanner'].main[0].map(c => c.node), ['Read Notion Attendees']);
  assert.deepEqual(nwf.connections['Funnel Summary'].main[0].map(c => c.node), ['Read Notion Attendees']);
});
