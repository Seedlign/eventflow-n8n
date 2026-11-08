import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModules } from '../scripts/lib/modules.mjs';

const { runBatch, sortedEvents, makeToken, findCredential } = loadModules(['sha256', 'tokens', 'engine']);
const batch = JSON.parse(readFileSync(new URL('../fixtures/trackd-batch.json', import.meta.url), 'utf8'));
const settings = { secret: 'test-secret', demo_recipient: '', attendees_database_snapshot: batch.attendees_database_snapshot };
const NOW = '2026-11-08T13:40:00.000Z';
const minutesAfter = (iso, m) => new Date(Date.parse(iso) + m * 60000).toISOString();

// what the next run's Read Attendees returns: changed rows merged over the previous sheet
function applyToSheet(rows, changed) {
  const byId = new Map(rows.map(r => [r.user_id, r]));
  for (const r of changed) byId.set(r.user_id, { ...byId.get(r.user_id), ...r });
  return [...byId.values()].map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')])));
}

// what Record Pass Sent / Record Certificate Sent write after Gmail succeeds
function markSent(rows, emails, at = NOW) {
  const column = { entry_pass: 'pass_sent_at', certificate: 'certificate_sent_at' };
  return rows.map(r => {
    const sent = emails.filter(e => e.attendee.user_id === r.user_id);
    return sent.reduce((row, e) => ({ ...row, [column[e.kind]]: at }), r);
  });
}

const first = runBatch(sortedEvents(batch), [], settings, NOW);
const outcome = seq => first.log.find(l => l.sequence === seq).outcome;
const firstSheet = applyToSheet([], first.attendees);
const finalStatus = Object.fromEntries(firstSheet.map(r => [r.user_id, r.status]));

// one attendee registered (no snapshot token), as the sheet would hold them
function sheetWith(id, extra = {}) {
  const r = runBatch([{ sequence: 1, event_type: 'registration_submitted', user_id: id, full_name: 'A ' + id, email: id + '@x.ph' }], [], settings, NOW);
  return applyToSheet([], r.attendees).map(row => ({ ...row, ...extra }));
}

test('organizer batch ends with four completers and one no-show', () => {
  assert.deepEqual(finalStatus, {
    'REG-8001': 'Completed', 'REG-8002': 'Completed', 'REG-8003': 'Completed',
    'REG-8004': 'Completed', 'REG-8005': 'Registered',
  });
});

test('every event gets one log row, in sequence order', () => {
  assert.deepEqual(first.log.map(l => l.sequence), Array.from({ length: 15 }, (_, i) => i + 1));
});

test('repeat scan is a duplicate, early submission is unverified, decided from state', () => {
  assert.equal(outcome(9), 'DUPLICATE');
  assert.equal(outcome(12), 'UNVERIFIED');
  assert.equal(first.log.find(l => l.sequence === 12).to_status, 'Registered');
  assert.equal(outcome(13), 'OK');
  assert.equal(outcome(15), 'OK');
});

test('a plain checkin_scanned for someone already in is still a duplicate', () => {
  const rows = sheetWith('U1');
  const scan = { event_type: 'checkin_scanned', user_id: 'U1', token: rows[0].token };
  const r = runBatch([{ sequence: 1, ...scan }, { sequence: 2, ...scan }], rows, settings, NOW);
  assert.deepEqual(r.log.map(l => l.outcome), ['OK', 'DUPLICATE']);
});

test('five entry passes and four certificates are planned, none for the no-show', () => {
  const kinds = first.emails.map(e => `${e.kind}:${e.attendee.user_id}`);
  assert.equal(first.emails.filter(e => e.kind === 'entry_pass').length, 5);
  assert.deepEqual(first.emails.filter(e => e.kind === 'certificate').map(e => e.attendee.user_id).sort(),
    ['REG-8001', 'REG-8002', 'REG-8003', 'REG-8004']);
  assert.ok(!kinds.includes('certificate:REG-8005'));
});

test('certificates only go to rows that have both check-in and submission', () => {
  for (const e of first.emails.filter(e => e.kind === 'certificate')) {
    assert.ok(e.attendee.checked_in_at && e.attendee.submitted_at && e.attendee.verification_id);
  }
});

// --- tokens: the token authorises a scan or submission, the user_id does not

test('registration adopts the pre-issued token from the organizer snapshot, so every organizer scan matches', () => {
  assert.equal(firstSheet.find(r => r.user_id === 'REG-8001').token, 'N8NPH-7A9B2C1D');
  const checkins = first.log.filter(l => l.intent === 'checkin' && l.outcome === 'OK');
  assert.equal(checkins.length, 4);
  assert.ok(checkins.every(l => l.token_match === 'true'));
});

test('a registrant not in the snapshot gets a generated HMAC token', () => {
  const rows = sheetWith('U1');
  assert.equal(rows[0].token, makeToken('test-secret', 'U1'));
});

test('a pre-issued token already held by another attendee is not handed out twice', () => {
  const rows = sheetWith('U9', { token: 'N8NPH-7A9B2C1D' });
  const r = runBatch([batch.raw_incoming_payloads[0]], rows, settings, NOW);
  assert.notEqual(r.attendees[0].token, 'N8NPH-7A9B2C1D');
});

test('a check-in with a token that is not on file is INVALID and changes nothing', () => {
  const r = runBatch([{ sequence: 1, event_type: 'checkin_scanned', user_id: 'U1', token: 'FORGED' }], sheetWith('U1'), settings, NOW);
  assert.equal(r.log[0].outcome, 'INVALID');
  assert.equal(r.log[0].to_status, 'Registered');
  assert.equal(r.log[0].token_match, 'false');
  assert.equal(r.attendees.length, 0);
});

test('a check-in without a token is INVALID', () => {
  const r = runBatch([{ sequence: 1, event_type: 'checkin_scanned', user_id: 'U1' }], sheetWith('U1'), settings, NOW);
  assert.equal(r.log[0].outcome, 'INVALID');
});

test('a token that belongs to someone else is INVALID for this user_id', () => {
  const rows = [...sheetWith('U1'), ...sheetWith('U2')];
  const r = runBatch([{ sequence: 1, event_type: 'checkin_scanned', user_id: 'U1', token: rows[1].token }], rows, settings, NOW);
  assert.equal(r.log[0].outcome, 'INVALID');
  assert.equal(r.attendees.length, 0);
});

test('a scan carrying only the token checks in the token owner', () => {
  const rows = sheetWith('U1');
  const r = runBatch([{ sequence: 1, event_type: 'checkin_scanned', token: rows[0].token }], rows, settings, NOW);
  assert.equal(r.log[0].outcome, 'OK');
  assert.equal(r.attendees[0].status, 'Attended');
});

test('a submission with a forged token is INVALID and issues no certificate', () => {
  const rows = sheetWith('U1', { status: 'Attended', checked_in_at: NOW });
  const r = runBatch([{ sequence: 1, event_type: 'project_submitted', user_id: 'U1', token: 'FORGED', submission_timestamp: NOW }], rows, settings, NOW);
  assert.equal(r.log[0].outcome, 'INVALID');
  assert.equal(r.emails.length, 0);
});

// --- certificate guardrail: only an exact Attended row with a check-in time may complete

test('a submission from a hand-edited status is UNVERIFIED, not certified', () => {
  for (const extra of [{ status: 'attended' }, { status: '' }, { status: 'Attended', checked_in_at: '' }]) {
    const rows = sheetWith('U1', extra);
    const r = runBatch([{ sequence: 1, event_type: 'project_submitted', user_id: 'U1', token: rows[0].token, submission_timestamp: NOW }], rows, settings, NOW);
    assert.equal(r.log[0].outcome, 'UNVERIFIED', JSON.stringify(extra));
    assert.equal(r.emails.length, 0, JSON.stringify(extra));
  }
});

test('a check-in for a status outside the lifecycle is INVALID, not a duplicate', () => {
  const rows = sheetWith('U1', { status: 'Cancelled' });
  const r = runBatch([{ sequence: 1, event_type: 'checkin_scanned', user_id: 'U1', token: rows[0].token }], rows, settings, NOW);
  assert.equal(r.log[0].outcome, 'INVALID');
});

// --- email delivery is confirmed by the Record ... Sent nodes; anything unconfirmed is retried

test('every queued email stamps email_queued_at on its row', () => {
  assert.ok(firstSheet.every(r => r.email_queued_at === NOW));
});

test('re-running over the resulting sheet changes nothing and sends nothing', () => {
  const second = runBatch(sortedEvents(batch), markSent(firstSheet, first.emails), settings, minutesAfter(NOW, 60));
  assert.equal(second.emails.length, 0);
  assert.equal(second.attendees.length, 0);
  assert.ok(second.log.every(l => l.outcome === 'DUPLICATE'));
  assert.ok(second.log.every(l => l.from_status === l.to_status));
});

test('an email that was never confirmed sent is queued again after the grace period', () => {
  const later = minutesAfter(NOW, 11);
  const r = runBatch([], firstSheet, settings, later);
  assert.deepEqual(r.emails.map(e => `${e.kind}:${e.attendee.user_id}`).sort(), [
    'certificate:REG-8001', 'certificate:REG-8002', 'certificate:REG-8003', 'certificate:REG-8004', 'entry_pass:REG-8005']);
  assert.ok(r.attendees.every(a => a.email_queued_at === later));
  assert.equal(r.summary.retries, 5);
});

test('an unconfirmed email is not queued again inside the grace period', () => {
  assert.equal(runBatch([], firstSheet, settings, minutesAfter(NOW, 5)).emails.length, 0);
});

test('a lost certificate is retried even though the submission itself is now a duplicate', () => {
  const sheet = markSent(firstSheet, first.emails.filter(e => e.attendee.user_id !== 'REG-8002'));
  const r = runBatch(sortedEvents(batch), sheet, settings, minutesAfter(NOW, 30));
  assert.deepEqual(r.emails.map(e => `${e.kind}:${e.attendee.user_id}`), ['certificate:REG-8002']);
});

test('unknown attendee and unknown event type are INVALID with no side effects', () => {
  const ev = [
    { sequence: 1, event_type: 'checkin_scanned', user_id: 'NOPE', token: 'X' },
    { sequence: 2, event_type: 'party_started', user_id: 'NOPE' },
    { sequence: 3, event_type: 'registration_submitted', user_id: 'U2', full_name: '', email: '' },
  ];
  const r = runBatch(ev, [], settings, NOW);
  assert.deepEqual(r.log.map(l => l.outcome), ['INVALID', 'INVALID', 'INVALID']);
  assert.equal(r.emails.length + r.attendees.length, 0);
});

test('demo recipient overrides the address but keeps the original', () => {
  const r = runBatch(sortedEvents(batch), [], { ...settings, demo_recipient: 'me@gmail.com' }, NOW);
  assert.ok(r.emails.every(e => e.to === 'me@gmail.com' && e.original_email.endsWith('@dummymail.ph')));
});

test('summary counts the funnel', () => {
  assert.deepEqual(first.summary.funnel, { registered: 5, attended: 4, completed: 4 });
});

test('summary names its source and carries each verdict, so the live webhook can answer the scanner', () => {
  const rows = sheetWith('U1');
  const live = { ...settings, processing_batch_metadata: { source: 'webhook' } };
  const r = runBatch([{ sequence: 1, event_type: 'checkin_scanned', token: rows[0].token }], rows, live, NOW);
  assert.equal(r.summary.source, 'webhook');
  assert.deepEqual(r.summary.results, [{ sequence: 1, user_id: 'U1', full_name: 'A U1', outcome: 'OK',
    reason: r.log[0].reason, from_status: 'Registered', to_status: 'Attended' }]);
  assert.equal(first.summary.source, 'batch');
});

// --- public verification of an issued credential

test('findCredential only vouches for a Completed row with that exact verification id', () => {
  const done = firstSheet.find(r => r.user_id === 'REG-8001');
  assert.equal(findCredential(firstSheet, done.verification_id).user_id, 'REG-8001');
  assert.equal(findCredential(firstSheet, ' ' + done.verification_id.toLowerCase() + ' ').user_id, 'REG-8001');
  assert.equal(findCredential(firstSheet, 'VER-000000000000'), null);
  assert.equal(findCredential(firstSheet, ''), null);
  assert.equal(findCredential([{ ...done, status: 'Attended' }], done.verification_id), null);
});

// --- registration hardening

test('a registration without user_id gets one derived from the email', () => {
  const r = runBatch([{ sequence: 1, event_type: 'registration_submitted', full_name: 'Web Form', email: 'Web@Form.ph' }], [], settings, NOW);
  assert.equal(r.log[0].outcome, 'OK');
  assert.match(r.attendees[0].user_id, /^REG-[0-9A-F]{8}$/);
});

test('the same email registering again, in any case or spacing, is DUPLICATE', () => {
  const rows = sheetWith('U1');
  const r = runBatch([{ sequence: 1, event_type: 'registration_submitted', user_id: 'U2', full_name: 'B', email: ' U1@X.PH ' }], rows, settings, NOW);
  assert.equal(r.log[0].outcome, 'DUPLICATE');
  assert.equal(r.emails.length, 0);
});

test('a generated token that collides with one on file is re-derived', () => {
  const rows = sheetWith('U9', { token: makeToken('test-secret', 'U1') });
  const r = runBatch([{ sequence: 1, event_type: 'registration_submitted', user_id: 'U1', full_name: 'A', email: 'a1@x.ph' }], rows, settings, NOW);
  assert.match(r.attendees[0].token, /^N8NPH-[0-9A-F]{8}$/);
  assert.notEqual(r.attendees[0].token, rows[0].token);
});
