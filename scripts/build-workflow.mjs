// Builds the EventFlow n8n workflow JSON from src/ modules.
// Usage: npm run build   ->   dist/eventflow.json   (settings from config/local.json, created on first run)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { concatModules, loadModules } from './lib/modules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TRACK_D_URL = 'https://khylepanganiban.app.n8n.cloud/webhook/TrackDData';
const { ATTENDEE_COLUMNS } = loadModules(['engine']);
const LOG_COLUMNS = ['log_id', 'run_at', 'sequence', 'event_type', 'intent', 'user_id', 'full_name', 'outcome', 'reason',
  'from_status', 'to_status', 'token_presented', 'token_match'];
const FUNNEL_COLUMNS = ['run_at', 'source', 'events', 'registered', 'attended', 'completed', 'ok', 'duplicate', 'unverified', 'invalid', 'retries'];
const ACTIONS = [['attendee', 'Upsert Attendee'], ['log', 'Append Event Log'], ['entry_pass', 'Send Entry Pass'], ['certificate', 'Send Certificate']];

const readGlue = name => readFileSync(join(ROOT, 'src', 'glue', `${name}.js`), 'utf8');

// stable ids so rebuilding and re-importing does not churn the workflow
function stableId(name) {
  const h = createHash('md5').update(`eventflow:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function codeNode(name, position, modules, glue, mode = 'runOnceForAllItems') {
  const header = `// EventFlow: ${name}. Generated from src/ by scripts/build-workflow.mjs.`;
  const jsCode = [header, modules.length ? concatModules(modules) : '', glue].filter(Boolean).join('\n');
  return { name, type: 'n8n-nodes-base.code', typeVersion: 2, position, parameters: { mode, jsCode } };
}

const sheetSchema = cols => cols.map(id => ({ id, displayName: id, required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true }));
const sheet = (config, tab) => ({
  documentId: { __rl: true, value: config.sheetId, mode: 'id' },
  sheetName: { __rl: true, value: tab, mode: 'name' },
});

function writeNode(name, position, config, tab, operation, columns, matchingColumns = []) {
  return {
    name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position,
    parameters: {
      operation, ...sheet(config, tab),
      columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns, schema: sheetSchema(columns) },
      options: { cellFormat: 'RAW', handlingExtraData: 'ignoreIt' },
    },
  };
}

// failures leave on the error output, so only a delivered email reaches its Record ... Sent node
function gmailNode(name, position, withAttachment) {
  const options = { appendAttribution: false, senderName: '={{ $(\'Event Settings\').first().json.event_name }}' };
  if (withAttachment) options.attachmentsUi = { attachmentsBinary: [{ property: 'certificate,badge' }] };
  return {
    name, type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position, onError: 'continueErrorOutput',
    parameters: { sendTo: '={{ $json.to }}', subject: '={{ $json.subject }}', emailType: 'html', message: '={{ $json.html }}', options },
  };
}

// stamps one delivery column on the attendee the email was for; the engine retries rows left unstamped
function sentStampNode(name, position, config, column) {
  return {
    name, type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position,
    parameters: {
      operation: 'appendOrUpdate', ...sheet(config, 'Attendees'),
      columns: {
        mappingMode: 'defineBelow', matchingColumns: ['user_id'], schema: sheetSchema(['user_id', column]),
        value: { user_id: '={{ $(\'Route by Action\').item.json.user_id }}', [column]: '={{ $now.toUTC().toISO() }}' },
      },
      options: { cellFormat: 'RAW' },
    },
  };
}

function respondNode(name, position, parameters) {
  return { name, type: 'n8n-nodes-base.respondToWebhook', typeVersion: 1.1, position, parameters };
}

function sticky(name, position, width, height, content, color) {
  return { name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position, parameters: { content, width, height, color } };
}

function equalsCondition(id, leftValue, rightValue) {
  return {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: stableId(id), leftValue, rightValue, operator: { type: 'string', operation: 'equals' } }],
    combinator: 'and',
  };
}

function switchRule(action) {
  return { conditions: equalsCondition(`route:${action}`, '={{ $json.action }}', action), renameOutput: true, outputKey: action };
}

export function buildWorkflow(config) {
  const nodes = [
    sticky('Note: Intake', [-80, -180], 700, 900, '## 1. Intake\n**Batch:** the organizer HTTP Request pulls the Track D event batch.\n\n**Live:** `POST /webhook/eventflow-live` (header `X-EventFlow-Key`) takes registrations, scans or submissions.\n\n**Webform:** `/form/register` takes a registration.\n\nAll three feed the same engine.', 7),
    sticky('Note: Engine', [640, -180], 700, 640, '## 2. State engine\nReads the Attendees tab once, then walks events in `sequence` order against it.\n\nThe event label is only the intent. The row\'s status decides: Registered -> Attended -> Completed, or DUPLICATE / UNVERIFIED / INVALID.\n\nScans and submissions are authorised by the **token**, never the user_id. Tokens are pre-issued (organizer snapshot) or HMAC-SHA256 with the event secret. A re-run changes nothing and sends nothing; unconfirmed emails are retried after 10 minutes.', 5),
    sticky('Note: Outputs', [1360, -420], 900, 1420, '## 3. Writes, email and reply\nChanged rows upsert into **Attendees** by `user_id`. Every event, accepted or not, appends to **EventLog** with its reason.\n\nEntry passes carry the token and a QR code. Certificates go only to Attended rows that submitted, as a PDF with name, date and verification ID, plus an SVG badge. A delivered email stamps `pass_sent_at` / `certificate_sent_at`; a failed one leaves by the Gmail error output.\n\nEach run appends its counts to **Funnel**. Live webhook calls get the verdict back as JSON.', 4),
    sticky('Note: Verify', [-80, 860], 960, 300, '## 4. Public verification\n`GET /webhook/verify?id=VER-...` is the link printed on every certificate. It vouches only for a **Completed** row holding that exact ID.', 6),
    { name: 'Run Batch', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { name: 'Get Track D Data', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [220, 0], parameters: { method: 'GET', url: TRACK_D_URL, options: {} } },
    { name: 'Live Event', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 260], webhookId: stableId('webhook'), parameters: { httpMethod: 'POST', path: 'eventflow-live', authentication: 'headerAuth', responseMode: 'responseNode', options: {} } },
    codeNode('Wrap Live Event', [220, 260], [], readGlue('live'), 'runOnceForEachItem'),
    { name: 'Registration Form', type: 'n8n-nodes-base.formTrigger', typeVersion: 2.2, position: [0, 520], webhookId: stableId('webhook:form'),
      parameters: {
        path: 'register', formTitle: config.eventName, formDescription: 'Register to get your entry pass by email.',
        formFields: { values: [
          { fieldLabel: 'Full name', requiredField: true },
          { fieldLabel: 'Email', fieldType: 'email', requiredField: true },
          { fieldLabel: 'Organization' },
          { fieldLabel: 'Role' },
        ] },
        options: {},
      } },
    codeNode('Wrap Form Entry', [220, 520], [], readGlue('form'), 'runOnceForEachItem'),
    {
      name: 'Event Settings', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [440, 120],
      parameters: {
        mode: 'manual', includeOtherFields: true, options: {},
        assignments: { assignments: [
          ['event_name', config.eventName], ['demo_recipient', config.demoRecipient], ['secret', config.secret],
          ['verify_base_url', `${(config.n8nBaseUrl || '').replace(/\/+$/, '')}/webhook/verify?id=`],
        ].map(([name, value]) => ({ id: stableId(`setting:${name}`), name, value, type: 'string' })) },
      },
    },
    { name: 'Read Attendees', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [700, 120], executeOnce: true, alwaysOutputData: true,
      parameters: { ...sheet(config, 'Attendees'), options: {} } },
    codeNode('Run Lifecycle Engine', [920, 120], ['sha256', 'tokens', 'engine', 'pdf', 'templates'], readGlue('engine')),
    {
      name: 'Route by Action', type: 'n8n-nodes-base.switch', typeVersion: 3.2, position: [1140, 120],
      parameters: { rules: { values: ACTIONS.map(([a]) => switchRule(a)) }, options: { fallbackOutput: 'extra', renameFallbackOutput: 'summary' } },
    },
    writeNode('Upsert Attendee', [1460, -260], config, 'Attendees', 'appendOrUpdate', ATTENDEE_COLUMNS, ['user_id']),
    writeNode('Append Event Log', [1460, -40], config, 'EventLog', 'append', LOG_COLUMNS),
    gmailNode('Send Entry Pass', [1460, 180], false),
    sentStampNode('Record Pass Sent', [1720, 160], config, 'pass_sent_at'),
    gmailNode('Send Certificate', [1460, 400], true),
    sentStampNode('Record Certificate Sent', [1720, 380], config, 'certificate_sent_at'),
    // lowest branch on the canvas runs last, so the reply goes out after the sheet writes and emails it reports on
    writeNode('Append Funnel Snapshot', [1460, 600], config, 'Funnel', 'append', FUNNEL_COLUMNS),
    { name: 'From Live Webhook?', type: 'n8n-nodes-base.if', typeVersion: 2, position: [1460, 780],
      parameters: { conditions: equalsCondition('if:live', '={{ $json.source }}', 'webhook'), options: {} } },
    respondNode('Reply to Scanner', [1720, 720], { respondWith: 'firstIncomingItem', options: {} }),
    { name: 'Funnel Summary', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [1720, 860], parameters: {} },
    { name: 'Verify Credential', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 1000], webhookId: stableId('webhook:verify'),
      parameters: { httpMethod: 'GET', path: 'verify', responseMode: 'responseNode', options: {} } },
    { name: 'Read Credentials', type: 'n8n-nodes-base.googleSheets', typeVersion: 4.5, position: [220, 1000], executeOnce: true, alwaysOutputData: true,
      parameters: { ...sheet(config, 'Attendees'), options: {} } },
    codeNode('Render Verification', [440, 1000], ['sha256', 'engine', 'templates'], `var EVENT_NAME = ${JSON.stringify(config.eventName)};\n${readGlue('verify')}`),
    respondNode('Reply with Verification', [660, 1000], {
      respondWith: 'text', responseBody: '={{ $json.html }}',
      options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] } },
    }),
  ];
  for (const n of nodes) n.id = stableId(n.name);

  const connections = {};
  const link = (from, to, output = 0) => {
    const main = (connections[from] ??= { main: [] }).main;
    while (main.length <= output) main.push([]);
    main[output].push({ node: to, type: 'main', index: 0 });
  };
  link('Run Batch', 'Get Track D Data');
  link('Get Track D Data', 'Event Settings');
  link('Live Event', 'Wrap Live Event');
  link('Wrap Live Event', 'Event Settings');
  link('Event Settings', 'Read Attendees');
  link('Read Attendees', 'Run Lifecycle Engine');
  link('Run Lifecycle Engine', 'Route by Action');
  ACTIONS.forEach(([, target], i) => link('Route by Action', target, i));
  link('Registration Form', 'Wrap Form Entry');
  link('Wrap Form Entry', 'Event Settings');
  link('Route by Action', 'Append Funnel Snapshot', ACTIONS.length);
  link('Route by Action', 'From Live Webhook?', ACTIONS.length);
  link('Send Entry Pass', 'Record Pass Sent');
  link('Send Certificate', 'Record Certificate Sent');
  link('From Live Webhook?', 'Reply to Scanner', 0);
  link('From Live Webhook?', 'Funnel Summary', 1);
  link('Verify Credential', 'Read Credentials');
  link('Read Credentials', 'Render Verification');
  link('Render Verification', 'Reply with Verification');

  return { name: 'EventFlow | Track D | Event Lifecycle & Verified Credentials', nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
}

function loadConfig() {
  const path = join(ROOT, 'config', 'local.json');
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sheetId: 'PASTE_SHEET_ID', demoRecipient: 'PASTE_DEMO_INBOX', secret: randomBytes(24).toString('hex'), eventName: 'Hack with the Flow: n8n Buildathon', n8nBaseUrl: 'https://PASTE_INSTANCE.app.n8n.cloud' }, null, 2));
    console.log(`created ${path}; fill in sheetId, demoRecipient and n8nBaseUrl, keep the secret`);
  }
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!config.n8nBaseUrl) console.warn(`${path} has no n8nBaseUrl; certificate verify links will not work`);
  return config;
}

// a copy safe to hand in: no event secret, sheet id or demo inbox
export function redact(workflow, config) {
  let text = JSON.stringify(workflow);
  for (const [value, placeholder] of [[config.secret, 'REPLACE_SECRET'], [config.sheetId, 'REPLACE_SHEET_ID'], [config.demoRecipient, 'REPLACE_DEMO_INBOX']]) {
    if (value) text = text.split(value).join(placeholder);
  }
  return JSON.parse(text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const workflow = buildWorkflow(config);
  const out = join(ROOT, 'dist', 'eventflow.json');
  const submission = join(ROOT, 'dist', 'eventflow-submission.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(workflow, null, 2));
  writeFileSync(submission, JSON.stringify(redact(workflow, config), null, 2));
  console.log(`wrote ${out} and ${submission}`);
}
