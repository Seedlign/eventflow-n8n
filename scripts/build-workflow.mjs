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
const { NOTION_VERSION } = loadModules(['notion']);
const LOG_COLUMNS = ['log_id', 'run_at', 'sequence', 'event_type', 'intent', 'user_id', 'full_name', 'outcome', 'reason',
  'from_status', 'to_status', 'token_presented', 'token_match'];
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

function gmailNode(name, position, withAttachment) {
  const options = { appendAttribution: false, senderName: '={{ $(\'Event Settings\').first().json.event_name }}' };
  if (withAttachment) options.attachmentsUi = { attachmentsBinary: [{ property: 'certificate' }] };
  return {
    name, type: 'n8n-nodes-base.gmail', typeVersion: 2.1, position, onError: 'continueRegularOutput',
    parameters: { sendTo: '={{ $json.to }}', subject: '={{ $json.subject }}', emailType: 'html', message: '={{ $json.html }}', options },
  };
}

// Notion is optional: the nodes are only built when config.notion has both database ids
const notionEnabled = config => Boolean(config.notion && config.notion.attendeesDb && config.notion.logDb);

function notionRequestNode(name, position) {
  return {
    name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position, onError: 'continueRegularOutput',
    parameters: {
      method: '={{ $json.method }}', url: '={{ $json.url }}',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'notionApi',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'Notion-Version', value: NOTION_VERSION }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body) }}',
      // Notion allows about 3 requests a second
      options: { batching: { batch: { batchSize: 1, batchInterval: 350 } } },
    },
  };
}

function notionNodes(config) {
  return [
    sticky('Note: Notion', [1660, -420], 700, 1120, '## 4. Notion dashboard\nA one-way mirror for people to watch: Sheets stays the source of truth.\n\nAfter every run, attendees missing from Notion are created and changed ones are updated, matched by **User ID**. A re-run sends nothing. Every log entry becomes a page in the event log, so blocked attempts show up too.\n\nNotion errors never stop the emails.', 6),
    {
      name: 'Read Notion Attendees', type: 'n8n-nodes-base.notion', typeVersion: 2.2, position: [1700, 600],
      executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput',
      parameters: { resource: 'databasePage', operation: 'getAll', databaseId: { __rl: true, value: config.notion.attendeesDb, mode: 'id' }, returnAll: true, simple: false, options: {} },
    },
    codeNode('Plan Notion Sync', [1920, 600], ['notion'], readGlue('notion-attendees')),
    notionRequestNode('Sync Notion Attendee', [2140, 600]),
    codeNode('Plan Notion Log', [1700, -40], ['notion'], readGlue('notion-log')),
    notionRequestNode('Append Notion Log', [1920, -40]),
  ];
}

function sticky(name, position, width, height, content, color) {
  return { name, type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position, parameters: { content, width, height, color } };
}

function switchRule(action) {
  return {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{ id: stableId(`route:${action}`), leftValue: '={{ $json.action }}', rightValue: action, operator: { type: 'string', operation: 'equals' } }],
      combinator: 'and',
    },
    renameOutput: true, outputKey: action,
  };
}

export function buildWorkflow(config) {
  const nodes = [
    sticky('Note: Intake', [-80, -180], 700, 640, '## 1. Intake\n**Batch:** the organizer HTTP Request pulls the Track D event batch.\n\n**Live:** `POST /webhook/eventflow-live` takes one registration, scan or submission and wraps it as a one-event batch.\n\nBoth feed the same engine.', 7),
    sticky('Note: Engine', [640, -180], 700, 640, '## 2. State engine\nReads the Attendees tab once, then walks events in `sequence` order against it.\n\nThe event label is only the intent. The row\'s status decides: Registered -> Attended -> Completed, or DUPLICATE / UNVERIFIED / INVALID.\n\nTokens and verification IDs are HMAC-SHA256 with the event secret. A re-run changes nothing and sends nothing.', 5),
    sticky('Note: Outputs', [1360, -420], 280, 1120, '## 3. Writes and email\nChanged rows upsert into **Attendees** by `user_id`. Every event, accepted or not, appends to **EventLog** with its reason.\n\nEntry passes carry the token and a QR code. Certificates go only to rows with both a check-in and a submission, as a PDF attachment with name, date, verification ID and the attendee\'s lifecycle path.', 4),
    { name: 'Run Batch', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    { name: 'Get Track D Data', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [220, 0], parameters: { method: 'GET', url: TRACK_D_URL, options: {} } },
    { name: 'Live Event', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 260], webhookId: stableId('webhook'), parameters: { httpMethod: 'POST', path: 'eventflow-live', options: {} } },
    codeNode('Wrap Live Event', [220, 260], [], readGlue('live'), 'runOnceForEachItem'),
    {
      name: 'Event Settings', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [440, 120],
      parameters: {
        mode: 'manual', includeOtherFields: true, options: {},
        assignments: { assignments: [
          ['event_name', config.eventName], ['demo_recipient', config.demoRecipient], ['secret', config.secret],
          ['verify_base_url', 'https://credentials.n8n.ph/verify/'],
          ...(notionEnabled(config) ? [['notion_attendees_db', config.notion.attendeesDb], ['notion_log_db', config.notion.logDb]] : []),
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
    gmailNode('Send Certificate', [1460, 400], true),
    { name: 'Funnel Summary', type: 'n8n-nodes-base.noOp', typeVersion: 1, position: [1460, 600], parameters: {} },
    ...(notionEnabled(config) ? notionNodes(config) : []),
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
  link('Route by Action', 'Funnel Summary', ACTIONS.length);
  if (notionEnabled(config)) {
    link('Funnel Summary', 'Read Notion Attendees');
    link('Read Notion Attendees', 'Plan Notion Sync');
    link('Plan Notion Sync', 'Sync Notion Attendee');
    link('Append Event Log', 'Plan Notion Log');
    link('Plan Notion Log', 'Append Notion Log');
  }

  return { name: 'EventFlow | Track D | Event Lifecycle & Verified Credentials', nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
}

function loadConfig() {
  const path = join(ROOT, 'config', 'local.json');
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ sheetId: 'PASTE_SHEET_ID', demoRecipient: 'PASTE_DEMO_INBOX', secret: randomBytes(24).toString('hex'), eventName: 'Hack with the Flow: n8n Buildathon' }, null, 2));
    console.log(`created ${path}; fill in sheetId and demoRecipient, keep the secret`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = join(ROOT, 'dist', 'eventflow.json');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(buildWorkflow(loadConfig()), null, 2));
  console.log(`wrote ${out}`);
}
