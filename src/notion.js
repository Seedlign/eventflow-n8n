// one-way mirror of the Sheets state into two Notion databases that make up the event dashboard.
// Sheets stays the source of truth; Notion is only a view, so a failed Notion write never blocks the lifecycle.
var NOTION_VERSION = '2022-06-28';
var NOTION_API = 'https://api.notion.com/v1';
var STATUS_COLORS = { Registered: 'blue', Attended: 'yellow', Completed: 'green' };
var OUTCOME_COLORS = { OK: 'green', DUPLICATE: 'orange', UNVERIFIED: 'red', INVALID: 'gray' };

function notionSelectOptions(colors) {
  return Object.keys(colors).map(function (name) { return { name: name, color: colors[name] }; });
}

// database schemas, used once by scripts/notion-setup.mjs to create the dashboard
var NOTION_ATTENDEE_SCHEMA = {
  'Name': { title: {} },
  'Status': { select: { options: notionSelectOptions(STATUS_COLORS) } },
  'User ID': { rich_text: {} },
  'Email': { email: {} },
  'Organization': { rich_text: {} },
  'Role': { rich_text: {} },
  'Project': { rich_text: {} },
  'Repository': { url: {} },
  'Verification ID': { rich_text: {} },
  'Token': { rich_text: {} },
  'Token match': { checkbox: {} },
  'Registered at': { date: {} },
  'Checked in at': { date: {} },
  'Completed at': { date: {} },
};

var NOTION_LOG_SCHEMA = {
  'Event': { title: {} },
  'Outcome': { select: { options: notionSelectOptions(OUTCOME_COLORS) } },
  'Intent': { select: { options: [{ name: 'register', color: 'blue' }, { name: 'checkin', color: 'yellow' }, { name: 'submit', color: 'green' }, { name: 'unknown', color: 'gray' }] } },
  'Sequence': { number: { format: 'number' } },
  'User ID': { rich_text: {} },
  'Name': { rich_text: {} },
  'Reason': { rich_text: {} },
  'From': { select: { options: notionSelectOptions(STATUS_COLORS) } },
  'To': { select: { options: notionSelectOptions(STATUS_COLORS) } },
  'Token presented': { rich_text: {} },
  'Run at': { date: {} },
};

function nText(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return { rich_text: s ? [{ type: 'text', text: { content: s.slice(0, 2000) } }] : [] };
}

function nTitle(v) {
  return { title: [{ type: 'text', text: { content: String(v || '').slice(0, 2000) } }] };
}

function nSelect(v) {
  return { select: v ? { name: String(v) } : null };
}

function nDate(v) {
  var d = new Date(v);
  return { date: v && !isNaN(d.getTime()) ? { start: d.toISOString() } : null };
}

function notionAttendeeProps(r) {
  return {
    'Name': nTitle(r.full_name),
    'Status': nSelect(r.status),
    'User ID': nText(r.user_id),
    'Email': { email: r.email || null },
    'Organization': nText(r.organization),
    'Role': nText(r.role),
    'Project': nText(r.project_name),
    'Repository': { url: r.repository_url || null },
    'Verification ID': nText(r.verification_id),
    'Token': nText(r.token),
    // tokens are enforced at check-in, so a checked-in attendee presented their own token
    'Token match': { checkbox: Boolean(r.checked_in_at) },
    'Registered at': nDate(r.registered_at),
    'Checked in at': nDate(r.checked_in_at),
    'Completed at': nDate(r.completed_at),
  };
}

function notionLogProps(l) {
  return {
    'Event': nTitle('#' + l.sequence + ' ' + l.event_type + (l.user_id ? ' · ' + l.user_id : '')),
    'Outcome': nSelect(l.outcome),
    'Intent': nSelect(l.intent),
    'Sequence': { number: Number(l.sequence) },
    'User ID': nText(l.user_id),
    'Name': nText(l.full_name),
    'Reason': nText(l.reason),
    'From': nSelect(l.from_status),
    'To': nSelect(l.to_status),
    'Token presented': nText(l.token_presented),
    'Run at': nDate(l.run_at),
  };
}

// reads the user id off a page from the Notion node, raw (simple off) or simplified
function notionPageUserId(p) {
  if (!p) return '';
  if (p.properties && p.properties['User ID']) {
    return (p.properties['User ID'].rich_text || []).map(function (t) { return t.plain_text || (t.text && t.text.content) || ''; }).join('').trim();
  }
  return String(p.property_user_id || '').trim();
}

// sheet rows (before this run) overlaid with this run's changed rows. A user with no Notion page is created,
// so the first sync backfills everyone; a changed user with a page is patched; everyone else is left alone,
// so a re-run sends nothing
function planAttendeeSync(sheetRows, changedRows, pages, databaseId) {
  var byUser = {};
  (pages || []).forEach(function (p) { var id = notionPageUserId(p); if (id && p.id && !byUser[id]) byUser[id] = p.id; });
  var rows = {};
  var changed = {};
  (sheetRows || []).forEach(function (r) { if (r && r.user_id) rows[r.user_id] = r; });
  (changedRows || []).forEach(function (r) { if (r && r.user_id) { rows[r.user_id] = r; changed[r.user_id] = true; } });
  var plan = [];
  Object.keys(rows).forEach(function (id) {
    var props = notionAttendeeProps(rows[id]);
    var pageId = byUser[id];
    if (!pageId) plan.push({ user_id: id, method: 'POST', url: NOTION_API + '/pages', body: { parent: { database_id: databaseId }, properties: props } });
    else if (changed[id]) plan.push({ user_id: id, method: 'PATCH', url: NOTION_API + '/pages/' + pageId, body: { properties: props } });
  });
  return plan;
}

function planLogAppend(logs, databaseId) {
  return (logs || []).filter(function (l) { return l && l.log_id; }).map(function (l) {
    return { log_id: l.log_id, method: 'POST', url: NOTION_API + '/pages', body: { parent: { database_id: databaseId }, properties: notionLogProps(l) } };
  });
}
