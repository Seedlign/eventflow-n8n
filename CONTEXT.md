# EventFlow context

What we are solving, what we built, and how to pick it up. Read this before touching the workflow.

## The challenge

Hack with the Flow: n8n Buildathon finals, Track D (Event Manager), set by the n8n Philippines User Group on 2026-11-08. Submission deadline 11:45 AM.

Volunteer-run tech events lose time on manual operations: slow check-in queues on spreadsheets, certificates designed and emailed by hand days later, certificates sent to no-shows, and no view of how many registrants actually attended or finished. The brief asks for one n8n pipeline that:

1. Takes a registration, generates a unique token, stores the attendee and emails an entry pass.
2. Takes a check-in scan, validates the token, blocks duplicate check-ins and moves the attendee from Registered to Attended.
3. Takes a project submission, confirms the attendee is Attended, renders a certificate with name, date and verification ID, and emails it.

Required nodes: HTTP Request (`GET https://khylepanganiban.app.n8n.cloud/webhook/TrackDData`), Google Sheets, Code, Gmail. Judged on accurate state transitions, zero certificates to unverified people, and zero manual steps.

## The organizer data

`fixtures/trackd-batch.json` is a saved copy of what the `TrackDData` endpoint returns: 15 events across 5 people, plus a snapshot of an attendee table.

| Person | What happens in the batch |
|---|---|
| REG-8001 Juancho Santos | Registers, checks in, submits, then gets scanned again (seq 9, a duplicate) |
| REG-8002 Maria Teresa Cruz | Clean run |
| REG-8003 Ramil Villanueva | Clean run |
| REG-8004 Angelica Bautista | Submits before checking in (seq 12, must be rejected), checks in (seq 13), submits again (seq 15, valid) |
| REG-8005 Kevin Bryan Tan | Registers, never shows up |

Three traps in this data, and what we decided:

- **The scans carry tokens we never issued.** Registration events have no token, but check-in events arrive with fixed ones like `N8NPH-7A9B2C1D`. We generate our own token as the brief requires, match check-ins by `user_id`, and record `token_match=false` in the log instead of rejecting the scan. Rejecting would fail every check-in and no one would ever finish.
- **Event labels are not trusted.** Two events arrive pre-labeled `duplicate_checkin_attempt` and `unverified_project_submission_attempt`. We read the label only as intent (register, check in, submit). The attendee's status in the sheet decides the outcome, so a real duplicate that arrives as a plain `checkin_scanned` is still caught.
- **Angelica ends Completed, and the organizer snapshot says Attended.** Processing in sequence order, her seq 12 submission is rejected and her seq 15 submission is valid. We think the snapshot is stale. Say this in the pitch rather than hide it.

## What we built

One n8n workflow, built from tested source in this repo.

```
Run Batch -> Get Track D Data (GET TrackDData) --+
                                                 +-> Event Settings -> Read Attendees -> Run Lifecycle Engine -> Route by Action
Live Event (POST /webhook/eventflow-live) -> Wrap Live Event --+                                                   |
                                                                       Upsert Attendee <-- attendee ---------------+
                                                                       Append Event Log <-- log -------------------+
                                                                       Send Entry Pass <-- entry_pass -------------+
                                                                       Send Certificate <-- certificate -----------+
                                                                       Funnel Summary  <-- summary ----------------+
```

- **One Code node runs the state machine** (`src/engine.js`). It reads the Attendees sheet once and walks the events in `sequence` order against an in-memory copy, so seq 9 sees what seq 3 did. Parallel Sheets lookups per item would not.
- **Outcomes:** `OK`, `DUPLICATE` (already registered, already checked in, credential already issued), `UNVERIFIED` (submitted before check-in), `INVALID` (unknown person or event type, missing fields). Every event gets one EventLog row with a reason, accepted or not.
- **Tokens and verification IDs are HMAC-SHA256** with an event secret (`src/sha256.js`, `src/tokens.js`), written in plain JS so the cloud Code node needs no `crypto` module. A verification ID signs user, token and completion date, so it can't be forged from public fields.
- **Re-runs are safe.** Only changed rows are written and emails go out only on a state change. Running the same batch twice adds 15 DUPLICATE log rows and sends nothing.
- **Entry pass:** HTML email with the token as text and a QR image (api.qrserver.com).
- **Certificate:** a real PDF built to the design handoff (`Buildathon certificate redesign`), generated in the Code node with no browser, library or outside service. The static design (card, grain, wire fan, logo, step cards, labels) is one JPEG baked from the handoff template (`src/certassets.js`, generated); the per-person text (name, statement, the three timestamps, date, verification ID, verify URL) is drawn on top in embedded Newsreader, Manrope and JetBrains Mono subsets at the positions the browser lays them out (`src/pdf.js`, `src/templates.js`). Matches the designer's render within anti-aliasing.
- **Demo inbox:** every email goes to `demo_recipient` in the `Event Settings` node, because the organizer addresses are `@dummymail.ph`. The original address is printed in each email. Clear the field to send to real addresses.

## Results on the organizer batch

Verified on the cloud instance and in tests:

- 5 Registered, 4 Attended, 4 Completed. Kevin stays Registered.
- Seq 9 DUPLICATE, seq 12 UNVERIFIED, everything else OK.
- 9 emails: 5 entry passes, 4 PDF certificates. None to Kevin, one to Angelica.
- Second run: all DUPLICATE, no emails, no Attendees changes.

## Where things are

- Google Sheet: `EventFlow` (owned by ricbarrios45@gmail.com), tabs `Attendees` and `EventLog`. Headers are listed in `README.md`.
- Workflow: imported from `dist/eventflow.json` into `khylepanganiban.app.n8n.cloud`. Google Sheets and Gmail credentials are picked by hand after import; they are not in the file.
- Repo: `Seedlign/eventflow-n8n`. Work happens on `dev`.

## Working on it

- `src/*.js` is the source of truth for the Code nodes. Change it there, run `npm test`, run `npm run build`, re-import. Edits made inside n8n are lost on the next import.
- `src/` files are plain top-level `function` and `var` declarations with no imports, because the build concatenates them into the Code node. Tests load the same concatenated code.
- `config/local.json` (git-ignored) holds the sheet ID, demo inbox, event name and the secret. Changing the secret changes every token and verification ID, so keep it for the life of an event.
- To demo from scratch, delete every row under the headers in both tabs, then run `Run Batch`.

## Known limits

- Token validation is advisory on the organizer data, by design (see the first trap above). On real data, where people scan the pass we sent, `token_match` would be `true`.
- The secret sits in the `Event Settings` node, so it shows on the canvas. Fine for a demo; production would move it to a credential or environment variable.
- The verify URL (`credentials.n8n.ph/verify/...`) is printed on the certificate but no verify page exists yet.
- Not done: Airtable, a funnel metrics tab, a reset flow. Code review and security review were skipped to make the deadline.
