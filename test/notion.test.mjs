import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadModules } from '../scripts/lib/modules.mjs';
import { pageIdFrom } from '../scripts/notion-setup.mjs';

const m = loadModules(['sha256', 'tokens', 'engine', 'notion']);
const batch = JSON.parse(readFileSync(new URL('../fixtures/trackd-batch.json', import.meta.url), 'utf8'));
// the workflow's Event Settings carries the whole batch, snapshot included, so registration reuses its pre-issued tokens
const run = m.runBatch(m.sortedEvents(batch), [], { secret: 's', attendees_database_snapshot: batch.attendees_database_snapshot }, '2026-11-08T03:00:00.000Z');
const DB = 'db-attendees';

test('attendee properties cover every schema column', () => {
  const juancho = run.attendees.find(r => r.user_id === 'REG-8001');
  const props = m.notionAttendeeProps(juancho);
  assert.deepEqual(Object.keys(props).sort(), Object.keys(m.NOTION_ATTENDEE_SCHEMA).sort());
  assert.equal(props.Name.title[0].text.content, juancho.full_name);
  assert.deepEqual(props.Status.select, { name: 'Completed' });
  assert.equal(props['Verification ID'].rich_text[0].text.content, juancho.verification_id);
  assert.ok(props['Completed at'].date.start);
});

test('each property value uses the type its schema column declares', () => {
  const props = m.notionAttendeeProps(run.attendees[0]);
  for (const [k, v] of Object.entries(props)) assert.deepEqual(Object.keys(v), Object.keys(m.NOTION_ATTENDEE_SCHEMA[k]), k);
  const logProps = m.notionLogProps(run.log[0]);
  assert.deepEqual(Object.keys(logProps).sort(), Object.keys(m.NOTION_LOG_SCHEMA).sort());
  for (const [k, v] of Object.entries(logProps)) assert.deepEqual(Object.keys(v), Object.keys(m.NOTION_LOG_SCHEMA[k]), k);
});

test('a never-checked-in attendee has empty dates and selects, not invalid values', () => {
  const kevin = m.notionAttendeeProps(run.attendees.find(r => r.user_id === 'REG-8005'));
  assert.equal(kevin['Checked in at'].date, null);
  assert.equal(kevin['Completed at'].date, null);
  assert.equal(kevin.Repository.url, null);
  assert.deepEqual(kevin.Project.rich_text, []);
  assert.equal(kevin['Token match'].checkbox, false);
});

const sheetBefore = run.attendees.map(r => ({ ...r }));

test('first sync backfills every sheet row into the attendees database', () => {
  const plan = m.planAttendeeSync(sheetBefore, [], [{}], DB);
  assert.equal(plan.length, 5);
  assert.ok(plan.every(p => p.method === 'POST' && p.url === 'https://api.notion.com/v1/pages' && p.body.parent.database_id === DB));
});

const pagesFor = ids => ids.map((id, i) => i % 2
  ? { id: 'page-' + id, property_user_id: id }
  : { id: 'page-' + id, properties: { 'User ID': { rich_text: [{ plain_text: id }] } } });

test('a re-run with every attendee already in Notion sends nothing', () => {
  assert.deepEqual(m.planAttendeeSync(sheetBefore, [], pagesFor(sheetBefore.map(r => r.user_id)), DB), []);
});

test('changed attendees patch their page, matched by User ID raw or simplified', () => {
  const kevin = { ...sheetBefore.find(r => r.user_id === 'REG-8005'), status: 'Attended', checked_in_at: '2026-11-08T11:00:00Z' };
  const plan = m.planAttendeeSync(sheetBefore, [kevin], pagesFor(sheetBefore.map(r => r.user_id)), DB);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].method, 'PATCH');
  assert.equal(plan[0].url, 'https://api.notion.com/v1/pages/page-REG-8005');
  assert.equal(plan[0].body.parent, undefined);
  assert.deepEqual(plan[0].body.properties.Status.select, { name: 'Attended' });
});

test('a new registration is created while existing pages are untouched', () => {
  const newbie = { user_id: 'REG-9001', full_name: 'New Person', status: 'Registered' };
  const plan = m.planAttendeeSync(sheetBefore, [newbie], pagesFor(sheetBefore.map(r => r.user_id)), DB);
  assert.deepEqual(plan.map(p => [p.user_id, p.method]), [['REG-9001', 'POST']]);
});

test('log append writes every event, blocked ones included', () => {
  const plan = m.planLogAppend(run.log, 'db-log');
  assert.equal(plan.length, 15);
  const outcomes = plan.map(p => p.body.properties.Outcome.select.name);
  assert.equal(outcomes.filter(o => o === 'DUPLICATE').length, 1);
  assert.equal(outcomes.filter(o => o === 'UNVERIFIED').length, 1);
  assert.match(plan.find(p => p.body.properties.Sequence.number === 9).body.properties.Event.title[0].text.content, /^#9 .* · REG-8001$/);
});

test('long text is clipped to the Notion 2000 character limit', () => {
  assert.equal(m.notionLogProps({ sequence: 1, reason: 'x'.repeat(5000) }).Reason.rich_text[0].text.content.length, 2000);
});

test('setup accepts a page URL or a bare id', () => {
  const id = '1a2b3c4d5e6f40718293a4b5c6d7e8f9';
  const want = '1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9';
  assert.equal(pageIdFrom(`https://www.notion.so/team/EventFlow-Dashboard-${id}?pvs=4`), want);
  assert.equal(pageIdFrom(want), want);
  assert.equal(pageIdFrom('not a page'), null);
});
