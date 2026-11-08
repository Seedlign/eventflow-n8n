// the event label only says what the caller wants; the sheet's status decides the outcome
var INTENTS = {
  registration_submitted: 'register',
  checkin_scanned: 'checkin',
  duplicate_checkin_attempt: 'checkin',
  project_submitted: 'submit',
  unverified_project_submission_attempt: 'submit',
};

var ATTENDEE_COLUMNS = ['user_id', 'full_name', 'email', 'organization', 'role', 'token', 'status', 'registered_at',
  'checked_in_at', 'submitted_at', 'project_name', 'repository_url', 'verification_id', 'completed_at',
  'email_queued_at', 'pass_sent_at', 'certificate_sent_at'];

// an email not confirmed by Record ... Sent within this window is assumed lost and queued again
var EMAIL_RETRY_MINUTES = 10;

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

function findByToken(state, token) {
  for (var k in state) if (state[k].token === token) return state[k];
  return null;
}

// who an event is about, for the log only; never used to authorise anything
function findRow(state, ev) {
  var id = clean(ev.user_id);
  if (id && state[id]) return state[id];
  var token = clean(ev.token);
  return token ? findByToken(state, token) : null;
}

// scans and submissions are authorised by the token; a user_id, if sent, must agree with it
function authorise(state, ev) {
  var token = clean(ev.token);
  var id = clean(ev.user_id);
  if (!token) return { error: 'no token presented' };
  var row = findByToken(state, token);
  if (!row) return { error: 'token not on file' };
  if (id && id !== row.user_id) return { error: 'token belongs to a different attendee' };
  return { row: row };
}

// the organizer's attendee snapshot already printed tokens on passes; reuse one only if nobody holds it yet
function issueToken(state, ev, settings, id) {
  var email = clean(ev.email).toLowerCase();
  var pre = (settings.attendees_database_snapshot || []).filter(function (s) {
    return clean(s.email).toLowerCase() === email && clean(s.token);
  })[0];
  if (pre && !findByToken(state, clean(pre.token))) return { token: clean(pre.token), source: 'pre-issued' };
  // 32-bit tokens can collide; re-derive until nobody on file holds it
  for (var attempt = 0; ; attempt++) {
    var token = makeToken(settings.secret, id, attempt);
    if (!findByToken(state, token)) return { token: token, source: 'generated' };
  }
}

// webform registrations carry no user_id; derive a stable one from the email
function registrationId(ev) {
  var id = clean(ev.user_id);
  var email = clean(ev.email).toLowerCase();
  return id || (email ? 'REG-' + sha256Hex(email).slice(0, 8).toUpperCase() : '');
}

function register(state, ev, settings) {
  var id = registrationId(ev);
  var email = clean(ev.email).toLowerCase();
  if (state[id]) return { outcome: 'DUPLICATE', reason: 'already registered' };
  for (var k in state) {
    if (email && state[k].email.toLowerCase() === email) return { outcome: 'DUPLICATE', reason: 'email already registered as ' + k };
  }
  if (!id || !clean(ev.full_name) || !clean(ev.email)) return { outcome: 'INVALID', reason: 'registration needs full_name and email' };
  var issued = issueToken(state, ev, settings, id);
  var row = rowFromSheet({});
  row.user_id = id;
  row.full_name = clean(ev.full_name);
  row.email = clean(ev.email);
  row.organization = clean(ev.organization);
  row.role = clean(ev.role);
  row.token = issued.token;
  row.status = 'Registered';
  row.registered_at = clean(ev.timestamp);
  state[id] = row;
  return { outcome: 'OK', reason: 'registered with ' + issued.source + ' token, entry pass issued', row: row, email: 'entry_pass' };
}

function checkin(row, ev) {
  if (row.status === 'Attended' || row.status === 'Completed') return { outcome: 'DUPLICATE', reason: 'already checked in at ' + row.checked_in_at };
  if (row.status !== 'Registered') return { outcome: 'INVALID', reason: 'status "' + row.status + '" cannot check in' };
  row.status = 'Attended';
  row.checked_in_at = clean(ev.scan_timestamp) || clean(ev.timestamp);
  return { outcome: 'OK', reason: 'checked in by ' + (clean(ev.scanned_by) || 'unknown desk'), row: row };
}

function submit(row, ev, settings) {
  if (row.status === 'Completed') return { outcome: 'DUPLICATE', reason: 'credential already issued as ' + row.verification_id };
  if (row.status === 'Registered') return { outcome: 'UNVERIFIED', reason: 'submission before check-in, no credential issued' };
  // anything but an exact Attended row with a check-in time is refused, so a hand-edited sheet cannot mint a credential
  if (row.status !== 'Attended' || !row.checked_in_at) {
    return { outcome: 'UNVERIFIED', reason: 'no verified check-in (status "' + row.status + '"), no credential issued' };
  }
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
  var auth = authorise(state, ev);
  if (auth.error) return { intent: intent, outcome: 'INVALID', reason: auth.error };
  return Object.assign({ intent: intent }, intent === 'checkin' ? checkin(auth.row, ev) : submit(auth.row, ev, settings));
}

// the one email a row still owes, if its delivery was never confirmed
function owedEmail(row) {
  if (row.status === 'Registered' && row.token && !row.pass_sent_at) return 'entry_pass';
  if (row.status === 'Completed' && row.verification_id && !row.certificate_sent_at) return 'certificate';
  return null;
}

function retryDue(row, now) {
  var queued = Date.parse(row.email_queued_at);
  return isNaN(queued) || Date.parse(now) - queued >= EMAIL_RETRY_MINUTES * 60000;
}

// a public verification URL carries only the id; it vouches for nothing unless that row is Completed
function findCredential(rows, id) {
  var want = clean(id).toUpperCase();
  if (!want) return null;
  return (rows || []).map(rowFromSheet).filter(function (r) {
    return r.status === 'Completed' && r.verification_id.toUpperCase() === want;
  })[0] || null;
}

// rows: current Attendees sheet; returns only rows that changed, so a re-run writes nothing
function runBatch(events, rows, settings, now) {
  var state = {};
  (rows || []).forEach(function (r) { var row = rowFromSheet(r); if (row.user_id) state[row.user_id] = row; });
  var changed = {};
  var log = [];
  var emails = [];
  var queue = function (kind, row) {
    row.email_queued_at = now;
    changed[row.user_id] = true;
    emails.push({ kind: kind, to: settings.demo_recipient || row.email, original_email: row.email, attendee: Object.assign({}, row) });
  };
  events.forEach(function (ev) {
    var existing = findRow(state, ev);
    var from = existing ? existing.status : '';
    var d = decide(state, ev, settings);
    var current = d.row || findRow(state, ev);
    var token = clean(ev.token);
    if (d.row) changed[d.row.user_id] = true;
    log.push({
      log_id: now + '#' + clean(ev.sequence),
      run_at: now,
      sequence: Number(ev.sequence),
      event_type: clean(ev.event_type),
      intent: d.intent,
      user_id: clean(ev.user_id) || (current ? current.user_id : ''),
      full_name: clean(ev.full_name) || (current ? current.full_name : ''),
      outcome: d.outcome,
      reason: d.reason,
      from_status: from,
      to_status: current ? current.status : '',
      token_presented: token,
      token_match: d.intent !== 'register' && token && current ? String(token === current.token) : '',
    });
    if (d.email) queue(d.email, d.row);
  });
  // after the events, so a row that just moved on is not sent a stale email
  var retries = 0;
  Object.keys(state).forEach(function (k) {
    var kind = owedEmail(state[k]);
    if (kind && retryDue(state[k], now)) { queue(kind, state[k]); retries++; }
  });
  var all = Object.keys(state).map(function (k) { return state[k]; });
  return {
    attendees: Object.keys(changed).map(function (k) { return state[k]; }),
    log: log,
    emails: emails,
    summary: {
      run_at: now,
      source: clean((settings.processing_batch_metadata || {}).source) || 'batch',
      events: events.length,
      retries: retries,
      funnel: {
        registered: all.length,
        attended: all.filter(function (r) { return r.checked_in_at; }).length,
        completed: all.filter(function (r) { return r.status === 'Completed'; }).length,
      },
      outcomes: log.reduce(function (acc, l) { acc[l.outcome] = (acc[l.outcome] || 0) + 1; return acc; }, {}),
      results: log.map(function (l) {
        return { sequence: l.sequence, user_id: l.user_id, full_name: l.full_name, outcome: l.outcome,
          reason: l.reason, from_status: l.from_status, to_status: l.to_status };
      }),
    },
  };
}
