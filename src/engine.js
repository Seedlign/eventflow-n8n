// the event label only says what the caller wants; the sheet's status decides the outcome
var INTENTS = {
  registration_submitted: 'register',
  checkin_scanned: 'checkin',
  duplicate_checkin_attempt: 'checkin',
  project_submitted: 'submit',
  unverified_project_submission_attempt: 'submit',
};

var ATTENDEE_COLUMNS = ['user_id', 'full_name', 'email', 'organization', 'role', 'token', 'status', 'registered_at',
  'checked_in_at', 'submitted_at', 'project_name', 'repository_url', 'verification_id', 'completed_at', 'token_match'];

function clean(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function sortedEvents(batch) {
  var list = (batch && batch.raw_incoming_payloads) || [];
  return list.slice().sort(function (a, b) { return Number(a.sequence) - Number(b.sequence); });
}

function rowFromSheet(r) {
  var row = {};
  ATTENDEE_COLUMNS.forEach(function (c) { row[c] = clean(r[c]); });
  return row;
}

function findRow(state, ev) {
  var id = clean(ev.user_id);
  if (id && state[id]) return state[id];
  var token = clean(ev.token);
  if (!token) return null;
  for (var k in state) if (state[k].token === token) return state[k];
  return null;
}

function register(state, ev, settings) {
  var id = clean(ev.user_id);
  if (state[id]) return { outcome: 'DUPLICATE', reason: 'already registered' };
  if (!id || !clean(ev.full_name) || !clean(ev.email)) return { outcome: 'INVALID', reason: 'registration needs user_id, full_name and email' };
  var row = rowFromSheet({});
  row.user_id = id;
  row.full_name = clean(ev.full_name);
  row.email = clean(ev.email);
  row.organization = clean(ev.organization);
  row.role = clean(ev.role);
  row.token = makeToken(settings.secret, id);
  row.status = 'Registered';
  row.registered_at = clean(ev.timestamp);
  state[id] = row;
  return { outcome: 'OK', reason: 'registered, entry pass issued', row: row, email: 'entry_pass' };
}

function checkin(row, ev) {
  if (row.status !== 'Registered') return { outcome: 'DUPLICATE', reason: 'already checked in at ' + row.checked_in_at };
  row.status = 'Attended';
  row.checked_in_at = clean(ev.scan_timestamp) || clean(ev.timestamp);
  row.token_match = String(clean(ev.token) === row.token);
  return { outcome: 'OK', reason: 'checked in by ' + (clean(ev.scanned_by) || 'unknown desk'), row: row };
}

function submit(row, ev, settings) {
  if (row.status === 'Registered') return { outcome: 'UNVERIFIED', reason: 'submission before check-in, no credential issued' };
  if (row.status === 'Completed') return { outcome: 'DUPLICATE', reason: 'credential already issued as ' + row.verification_id };
  var at = clean(ev.submission_timestamp) || clean(ev.timestamp);
  row.status = 'Completed';
  row.submitted_at = at;
  row.project_name = clean(ev.project_name);
  row.repository_url = clean(ev.repository_url);
  row.completed_at = at;
  row.verification_id = makeVerificationId(settings.secret, row.user_id, row.token, at.slice(0, 10));
  return { outcome: 'OK', reason: 'checked in and submitted, credential issued', row: row, email: 'certificate' };
}

function decide(state, ev, settings) {
  var intent = INTENTS[clean(ev.event_type)];
  if (!intent) return { intent: 'unknown', outcome: 'INVALID', reason: 'unknown event_type "' + clean(ev.event_type) + '"' };
  if (intent === 'register') return Object.assign({ intent: intent }, register(state, ev, settings));
  var row = findRow(state, ev);
  if (!row) return { intent: intent, outcome: 'INVALID', reason: 'no registration for this user_id or token' };
  return Object.assign({ intent: intent }, intent === 'checkin' ? checkin(row, ev) : submit(row, ev, settings));
}

// rows: current Attendees sheet; returns only rows that changed, so a re-run writes nothing
function runBatch(events, rows, settings, now) {
  var state = {};
  (rows || []).forEach(function (r) { var row = rowFromSheet(r); if (row.user_id) state[row.user_id] = row; });
  var changed = {};
  var log = [];
  var emails = [];
  events.forEach(function (ev) {
    var existing = findRow(state, ev);
    var from = existing ? existing.status : '';
    var d = decide(state, ev, settings);
    var current = d.row || findRow(state, ev);
    if (d.row) changed[d.row.user_id] = true;
    log.push({
      log_id: now + '#' + clean(ev.sequence),
      run_at: now,
      sequence: Number(ev.sequence),
      event_type: clean(ev.event_type),
      intent: d.intent,
      user_id: clean(ev.user_id),
      full_name: clean(ev.full_name) || (current ? current.full_name : ''),
      outcome: d.outcome,
      reason: d.reason,
      from_status: from,
      to_status: current ? current.status : '',
      token_presented: clean(ev.token),
      token_match: d.intent === 'checkin' && d.outcome === 'OK' ? d.row.token_match : '',
    });
    if (d.email) {
      emails.push({
        kind: d.email,
        to: settings.demo_recipient || d.row.email,
        original_email: d.row.email,
        attendee: Object.assign({}, d.row),
      });
    }
  });
  var all = Object.keys(state).map(function (k) { return state[k]; });
  return {
    attendees: Object.keys(changed).map(function (k) { return state[k]; }),
    log: log,
    emails: emails,
    summary: {
      run_at: now,
      events: events.length,
      funnel: {
        registered: all.length,
        attended: all.filter(function (r) { return r.checked_in_at; }).length,
        completed: all.filter(function (r) { return r.status === 'Completed'; }).length,
      },
      outcomes: log.reduce(function (acc, l) { acc[l.outcome] = (acc[l.outcome] || 0) + 1; return acc; }, {}),
    },
  };
}
