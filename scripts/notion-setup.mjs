// One-time: turns a Notion page into the EventFlow dashboard by creating the Attendees and Event log
// databases on it, then saves their ids to config/local.json so `npm run build` adds the Notion nodes.
// Usage: NOTION_TOKEN=ntn_... npm run notion:setup -- <notion page URL or id>
// The page must be shared with the integration first (page ... menu > Connections).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { loadModules } from './lib/modules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'config', 'local.json');
const { NOTION_API, NOTION_VERSION, NOTION_ATTENDEE_SCHEMA, NOTION_LOG_SCHEMA } = loadModules(['notion']);

export function pageIdFrom(input) {
  // the id is the last 32 hex digits of the URL path, after dropping ?query, #hash and dashes
  const hex = String(input || '').split(/[?#]/)[0].replace(/-/g, '').match(/[0-9a-f]{32}$/i);
  if (!hex) return null;
  const h = hex[0].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function notion(token, method, path, body) {
  const res = await fetch(NOTION_API + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json.code || ''} ${json.message || ''}`);
  return json;
}

const text = s => [{ type: 'text', text: { content: s } }];
const block = (type, s, extra = {}) => ({ object: 'block', type, [type]: { rich_text: text(s), ...extra } });

async function main() {
  const token = process.env.NOTION_TOKEN;
  const pageId = pageIdFrom(process.argv[2]);
  if (!token || !pageId) {
    console.error('usage: NOTION_TOKEN=ntn_... npm run notion:setup -- <notion page URL or id>');
    process.exit(1);
  }
  if (!existsSync(CONFIG)) {
    console.error(`${CONFIG} is missing; run npm run build once first`);
    process.exit(1);
  }
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (config.notion && config.notion.attendeesDb && !process.argv.includes('--force')) {
    console.error('config/local.json already has Notion databases; pass --force to create new ones');
    process.exit(1);
  }

  await notion(token, 'PATCH', `/blocks/${pageId}/children`, { children: [
    block('callout', 'Live view of the EventFlow n8n workflow. Google Sheets is the source of truth; this page updates on every run.', { icon: { type: 'emoji', emoji: '⚡' }, color: 'gray_background' }),
    block('heading_2', 'Attendees'),
  ] });
  const attendees = await notion(token, 'POST', '/databases', {
    parent: { type: 'page_id', page_id: pageId }, is_inline: true,
    title: text('EventFlow Attendees'), properties: NOTION_ATTENDEE_SCHEMA,
  });
  await notion(token, 'PATCH', `/blocks/${pageId}/children`, { children: [block('heading_2', 'Event log')] });
  const log = await notion(token, 'POST', '/databases', {
    parent: { type: 'page_id', page_id: pageId }, is_inline: true,
    title: text('EventFlow Event Log'), properties: NOTION_LOG_SCHEMA,
  });

  config.notion = { page: pageId, attendeesDb: attendees.id, logDb: log.id };
  writeFileSync(CONFIG, JSON.stringify(config, null, 2));
  console.log(`attendees database ${attendees.id}\nevent log database ${log.id}\nsaved to ${CONFIG}; now run npm run build`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
