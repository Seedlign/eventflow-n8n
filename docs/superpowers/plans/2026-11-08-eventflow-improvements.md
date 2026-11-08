# EventFlow Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps between EventFlow and the Track D brief (Manila dates, webform registration, token collisions, funnel visibility, webhook auth, a safe export) and produce the submission deliverables.

**Architecture:** All business logic stays in plain-JS modules under `src/` that `scripts/build-workflow.mjs` inlines into n8n Code nodes; tests load the same text through `scripts/lib/modules.mjs`. New n8n nodes are added in `buildWorkflow(config)` and covered by `test/build.test.mjs`, which runs generated Code node bodies with fake `$` / `$input`.

**Tech Stack:** Node 22 (`node --test`), n8n nodes (Code v2, Google Sheets v4.5, Gmail v2.1, Webhook v2, Form Trigger v2.2, Respond to Webhook v1.1, If v2, Switch v3.2).

**Spec:** `Hack-with-the-Flow_-n8n-Buildathon-Track-D-SSNA.pdf` (repo root, untracked) plus `README.md` for current behaviour.

## Global Constraints

- Statuses are exactly `Registered`, `Attended`, `Completed`.
- The organizer node stays `GET https://khylepanganiban.app.n8n.cloud/webhook/TrackDData`.
- Required node types stay present: HTTP Request, Google Sheets, Code, Gmail.
- Code in `src/*.js` is ES5-style (`var`, `function`) with no `require`, because it runs inside n8n Code nodes.
- Verification IDs keep their current derivation (`makeVerificationId(secret, user_id, token, completed_at.slice(0, 10))`) so IDs already issued keep verifying.
- Commit messages carry no AI attribution or co-author trailers.
- Organizer batch outcome must not change: 5 passes, 4 certificates, funnel 5 / 4 / 4, second run all DUPLICATE.

## Review Focus

1. Re-registration with the same email in a different case or with spaces (`" A@X.ph"` vs `"a@x.ph"`) should be DUPLICATE. Test in Task 2.
2. A live webhook body that is a JSON array of events should process each one, not one INVALID event. Test in Task 5.
3. A form submission's `submittedAt` with a `+08:00` offset should keep its instant and print the Manila date. Test in Task 3.
4. A completion late in the Manila evening (`2026-11-08T16:30:00Z`) prints November 9 on the certificate and the verify page, while its existing verification ID still verifies. Test in Task 1.
5. A run made only of INVALID events still writes a Funnel row with zeros, not blanks. Test in Task 4.

---

### Task 1: Print dates in Manila time

**Files:**
- Modify: `src/templates.js` (`longDate`, `shortStamp`)
- Test: `test/templates.test.mjs`

**Interfaces:**
- Produces: `var EVENT_TZ = 'Asia/Manila'`; `longDate(iso) -> 'November 9, 2026'`; `shortStamp(iso) -> 'Nov 9, 00:30 PHT'`. Both return `''` for an unparsable input, as now.

- [ ] **Step 1: Write the failing tests**

```js
test('dates print in Manila time', () => {
  const { longDate, shortStamp } = loadModules(['pdf', 'templates']);
  assert.equal(longDate('2026-11-08T16:30:00Z'), 'November 9, 2026');
  assert.equal(shortStamp('2026-11-08T16:30:00Z'), 'Nov 9, 00:30 PHT');
  assert.equal(shortStamp('2026-11-08T01:05:00Z'), 'Nov 8, 09:05 PHT');
  assert.equal(longDate('not a date'), '');
});

test('verification page shows the Manila completion date', () => {
  const page = verificationPage({ ...a, status: 'Completed', completed_at: '2026-11-08T16:30:00Z' }, 'VER-ABCDEF123456', 'x');
  assert.ok(page.html.includes('November 9, 2026'));
});
```
Update the existing PDF stamps test to expect `'Nov 8, 17:00 PHT'`, `'Nov 8, 18:15 PHT'`, `'Nov 8, 23:30 PHT'`.

- [ ] **Step 2: Run `node --test test/templates.test.mjs`.** Expected: the new tests and the updated stamps test FAIL.
- [ ] **Step 3: Implement** both functions with `Intl.DateTimeFormat('en-US', { timeZone: EVENT_TZ, ... }).formatToParts`. Use 24-hour time (`hourCycle: 'h23'`) and the fixed suffix `' PHT'`. Update the comment above `longDate`.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: Commit** `fix: print certificate dates in Manila time`.

### Task 2: Registration hardening (no user_id, same email, token collisions)

**Files:**
- Modify: `src/engine.js` (`register`, `issueToken`)
- Modify: `src/tokens.js` (`makeToken`)
- Test: `test/engine.test.mjs`, `test/tokens.test.mjs`

**Interfaces:**
- Produces: `makeToken(secret, userId, attempt)`, where `attempt` is optional and `0`/absent gives today's value. `register` accepts events without `user_id` and assigns `'REG-' + sha256Hex(normalisedEmail).slice(0, 8).toUpperCase()`. `normalisedEmail` is `clean(email).toLowerCase()`.

- [ ] **Step 1: Write the failing tests**

```js
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
```
In `test/tokens.test.mjs`, add `assert.equal(makeToken('s', 'REG-8001', 0), makeToken('s', 'REG-8001'))` and `assert.notEqual(makeToken('s', 'REG-8001', 1), makeToken('s', 'REG-8001'))`.

- [ ] **Step 2: Run `npm test`.** Expected: these FAIL.
- [ ] **Step 3: Implement.**
  - `makeToken` hashes `'token|' + userId` when `attempt` is falsy, else `'token|' + userId + '|' + attempt`.
  - `issueToken` loops `attempt` upward until `findByToken` returns null.
  - `register` checks for a duplicate email before any other check except an existing `user_id`.
  - Add `'sha256'` before `'engine'` wherever engine is loaded without it: the verify node in `build-workflow.mjs` and the `loadModules` calls in tests.
- [ ] **Step 4: Run `npm test`.** Expected: all pass, organizer batch tests unchanged.
- [ ] **Step 5: Commit** `feat: accept webform registrations and refuse duplicate emails`.

### Task 3: Webform registration channel

**Files:**
- Create: `src/glue/form.js`
- Modify: `scripts/build-workflow.mjs` (nodes, links, intake sticky text)
- Test: `test/build.test.mjs`

**Interfaces:**
- Consumes: Task 2's registration without `user_id`.
- Produces:
  - Node `Registration Form`: `n8n-nodes-base.formTrigger` v2.2, path `register`, formTitle = `config.eventName`. Fields, in order: `Full name` (required), `Email` (`fieldType: 'email'`, required), `Organization`, `Role`.
  - Node `Wrap Form Entry`: Code, runOnceForEachItem, glue `form`. It links `Registration Form -> Wrap Form Entry -> Event Settings`.
  - Output: `{ processing_batch_metadata: { batch_id: 'FORM-' + iso, source: 'form' }, raw_incoming_payloads: [{ sequence: 1, event_type: 'registration_submitted', full_name, email, organization, role, timestamp }] }`.

- [ ] **Step 1: Write the failing test**

```js
test('form glue turns a submission into a one-event registration batch', () => {
  const out = new Function('$json', node('Wrap Form Entry').parameters.jsCode)({
    'Full name': 'Ana Reyes', Email: 'ana@x.ph', Organization: 'PUP', Role: '', submittedAt: '2026-11-08T09:00:00.000+08:00' });
  assert.equal(out.json.processing_batch_metadata.source, 'form');
  assert.deepEqual(out.json.raw_incoming_payloads, [{ sequence: 1, event_type: 'registration_submitted', full_name: 'Ana Reyes',
    email: 'ana@x.ph', organization: 'PUP', role: '', timestamp: '2026-11-08T09:00:00.000+08:00' }]);
  assert.deepEqual(outputs('Registration Form'), [['Wrap Form Entry']]);
  assert.deepEqual(outputs('Wrap Form Entry'), [['Event Settings']]);
});
```
In `test/templates.test.mjs` add `assert.equal(longDate('2026-11-08T23:30:00.000+08:00'), 'November 8, 2026')`.

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (node missing).
- [ ] **Step 3: Implement** the glue and nodes. Place them at `[0, 520]` and `[220, 520]`, and grow the Intake sticky to cover them.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat: add a registration webform channel`.

### Task 4: Persist the funnel per run

**Files:**
- Modify: `src/glue/engine.js` (summary item)
- Modify: `scripts/build-workflow.mjs` (`FUNNEL_COLUMNS`, node `Append Funnel Snapshot`, links, positions)
- Modify: `README.md` (Sheet section: `Funnel` tab)
- Test: `test/build.test.mjs`

**Interfaces:**
- Produces:
  - `FUNNEL_COLUMNS = ['run_at', 'source', 'events', 'registered', 'attended', 'completed', 'ok', 'duplicate', 'unverified', 'invalid', 'retries']`.
  - The summary item gains those flat keys (numbers, defaulting to `0`).
  - Node `Append Funnel Snapshot`: `writeNode(..., 'Funnel', 'append', FUNNEL_COLUMNS)` at `[1460, 600]`. Move `From Live Webhook?` to `[1460, 780]`, so the snapshot is written before the reply.
  - `Route by Action` output 4 feeds both nodes.

- [ ] **Step 1: Write the failing test**

```js
test('every run appends one flat funnel row, zeros included', () => {
  const settings = { processing_batch_metadata: { source: 'webhook' }, raw_incoming_payloads: [{ sequence: 1, event_type: 'party' }], secret: 's' };
  const $ = () => ({ first: () => ({ json: settings }) });
  const out = new Function('$', '$input', node('Run Lifecycle Engine').parameters.jsCode)($, { all: () => [{ json: {} }] });
  const s = out.find(i => i.json.action === 'summary').json;
  assert.deepEqual([s.registered, s.ok, s.invalid, s.duplicate, s.unverified, s.retries], [0, 0, 1, 0, 0, 0]);
  assert.deepEqual(outputs('Route by Action')[4].sort(), ['Append Funnel Snapshot', 'From Live Webhook?']);
  assert.ok(node('Append Funnel Snapshot').position[1] < node('From Live Webhook?').position[1]);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement** the flat keys in `src/glue/engine.js` from `result.summary.funnel` and `result.summary.outcomes`. Add the node and links.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat: append a funnel snapshot per run`.

### Task 5: Lock the live webhook and accept event arrays

**Files:**
- Modify: `scripts/build-workflow.mjs` (`Live Event` parameters)
- Modify: `src/glue/live.js`
- Modify: `README.md` (Live webhook section: header name and curl example)
- Test: `test/build.test.mjs`

**Interfaces:**
- Produces:
  - `Live Event.parameters.authentication = 'headerAuth'`. The credential is an n8n Header Auth credential named `EventFlow Live Key` with header `X-EventFlow-Key`. It is chosen in the UI and never written to JSON.
  - `live.js` accepts `body` as an array, as `{ raw_incoming_payloads: [...] }`, or as one event.

- [ ] **Step 1: Write the failing tests**

```js
test('live webhook requires header auth', () => {
  assert.equal(node('Live Event').parameters.authentication, 'headerAuth');
});

test('live glue accepts a bare array of events', () => {
  const out = new Function('$json', node('Wrap Live Event').parameters.jsCode)({ body: [{ event_type: 'checkin_scanned', token: 'A' }, { event_type: 'checkin_scanned', token: 'B' }] });
  assert.deepEqual(out.json.raw_incoming_payloads.map(e => [e.sequence, e.token]), [[1, 'A'], [2, 'B']]);
});
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL.
- [ ] **Step 3: Implement** both. Leave `Verify Credential` public, since that link is meant for anyone.
- [ ] **Step 4: Run `npm test`.** Expected: all pass.
- [ ] **Step 5: Commit** `feat: require a key on the live webhook`.

### Task 6: Safe export for the submission

**Files:**
- Modify: `scripts/build-workflow.mjs` (export `redact`, entry-point guard, write second file)
- Modify: `README.md` (Build section)
- Test: `test/build.test.mjs`

**Interfaces:**
- Produces: `export function redact(workflow, config) -> workflow`. It returns a deep copy where every string occurrence of `config.secret`, `config.sheetId` and `config.demoRecipient` is replaced by `REPLACE_SECRET`, `REPLACE_SHEET_ID` and `REPLACE_DEMO_INBOX`. `npm run build` also writes `dist/eventflow-submission.json`. The entry-point guard becomes `process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`.

- [ ] **Step 1: Write the failing test**

```js
test('submission export carries no secret, sheet id or demo inbox and leaves the original intact', () => {
  const out = JSON.stringify(redact(wf, config));
  for (const v of [config.secret, config.sheetId, config.demoRecipient]) assert.ok(!out.includes(v), v);
  assert.ok(out.includes('REPLACE_SECRET'));
  assert.ok(JSON.stringify(wf).includes(config.secret));
});
```
Pick test-config values that are not substrings of other workflow text, e.g. `sheetId: 'SHEET-ID-123'`. The current `'SHEET'` would collide with "Google Sheets".

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (`redact` not exported).
- [ ] **Step 3: Implement** `redact` as a JSON round trip with string replacement via `split/join`.
- [ ] **Step 4: Run `npm test` and `npm run build`.** Expected: all pass, and `dist/eventflow-submission.json` exists.
- [ ] **Step 5: Commit** `feat: write a redacted workflow export for submission`.

### Task 7: Submission deliverables (page 4 of the brief)

**Files:**
- Create: `docs/submission.md`
- Create: `docs/workflow.png` (screenshot of the imported workflow canvas)

**Interfaces:**
- Consumes: the finished behaviour of Tasks 1–6 and the fixes already on `dev`.

- [ ] **Step 1: Import and screenshot.** Run `npm run build`, import `dist/eventflow.json` into n8n, and run **Run Batch** once against a cleared sheet. Screenshot the canvas with every sticky note visible and save it as `docs/workflow.png`.
- [ ] **Step 2: Write `docs/submission.md`** with the screenshot and one answer per question, using these facts.
  - **Q1 (no bypass, duplicates):**
    - The event label is only an intent; the Attendees row status decides the outcome.
    - Scans and submissions are authorised by token, and a token belonging to someone else is INVALID.
    - A certificate needs exactly `Attended` plus `checked_in_at`. A hand-edited status is UNVERIFIED.
    - A second scan of an Attended or Completed row is DUPLICATE and logged with the first check-in time.
    - Every attempt is appended to EventLog with a reason, and re-running a batch is a no-op.
    - Known limit: two scans in the same second through the live webhook can both read Registered. Both write the same Attended row, so state stays correct but two OK log rows appear.
  - **Q2 (tokens, validation):**
    - Tokens are `N8NPH-` plus the first 8 hex chars of HMAC-SHA256(event secret, `token|user_id`), computed in plain JS inside the Code node.
    - A collision with a token on file re-derives with an attempt counter.
    - Tokens the organizer snapshot already printed are reused.
    - Validation: Read Attendees loads the tab once per execution, and the engine indexes it by token in memory. Each event is checked against the state left by the events before it, so one batch cannot double-spend a token.
  - **Q3 (certificate, Gmail):**
    - The Code node draws a one-page vector PDF (A4 landscape, standard fonts, no library) with name, Manila date, verification ID and the attendee's Registered → Attended → Completed timestamps. Every value is escaped.
    - A PDF looks the same on any device. The email body is table-based HTML with inline styles.
    - The PDF travels as binary property `certificate` and is attached by the Gmail node through `attachmentsBinary`.
    - Delivery is confirmed by `certificate_sent_at` and retried after 10 minutes otherwise.
    - The printed verify link resolves on this workflow's `/webhook/verify` endpoint.
- [ ] **Step 3: Verify.** Every claim in `docs/submission.md` should match a test name or a node in `dist/eventflow.json`. Read it against `npm test` output and the canvas.
- [ ] **Step 4: Commit** `docs: add submission answers and workflow image`.
