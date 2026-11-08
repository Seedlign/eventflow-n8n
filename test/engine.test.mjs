import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModules } from '../scripts/lib/modules.mjs';

const { runBatch, sortedEvents } = loadModules(['sha256', 'tokens', 'engine']);
const batch = JSON.parse(readFileSync(new URL('../fixtures/trackd-batch.json', import.meta.url), 'utf8'));
const settings = { secret: 'test-secret', demo_recipient: '' };
const NOW = '2026-11-08T13:40:00.000Z';

// what the next run's Read Attendees returns: changed rows merged over the previous sheet
function applyToSheet(rows, changed) {
  const byId = new Map(rows.map(r => [r.user_id, r]));
  for (const r of changed) byId.set(r.user_id, { ...byId.get(r.user_id), ...r });
  return [...byId.values()].map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '')])));
}

const first = runBatch(sortedEvents(batch), [], settings, NOW);
const outcome = seq => first.log.find(l => l.sequence === seq).outcome;
const finalStatus = Object.fromEntries(applyToSheet([], first.attendees).map(r => [r.user_id, r.status]));

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
  const ev = [
    { sequence: 1, event_type: 'registration_submitted', user_id: 'U1', full_name: 'A', email: 'a@x.ph' },
    { sequence: 2, event_type: 'checkin_scanned', user_id: 'U1', token: 'T' },
    { sequence: 3, event_type: 'checkin_scanned', user_id: 'U1', token: 'T' },
  ];
  assert.equal(runBatch(ev, [], settings, NOW).log[2].outcome, 'DUPLICATE');
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

test('organizer tokens never match ours, so check-ins are accepted and flagged', () => {
  const checkins = first.log.filter(l => l.intent === 'checkin' && l.outcome === 'OK');
  assert.equal(checkins.length, 4);
  assert.ok(checkins.every(l => l.token_match === 'false'));
});

test('re-running over the resulting sheet changes nothing and sends nothing', () => {
  const second = runBatch(sortedEvents(batch), applyToSheet([], first.attendees), settings, NOW);
  assert.equal(second.emails.length, 0);
  assert.equal(second.attendees.length, 0);
  assert.ok(second.log.every(l => l.outcome === 'DUPLICATE'));
  assert.ok(second.log.every(l => l.from_status === l.to_status));
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
