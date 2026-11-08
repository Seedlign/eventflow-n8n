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

- **The scans carry tokens we never issued.** Registration events have no token, but check-in events arrive with fixed ones like `N8NPH-7A9B2C1D`, the same ones listed in `attendees_database_snapshot`. Registration reuses the snapshot's token for that email (if nobody else holds it), so the token printed on the pass is the one the desk scans. That lets us **enforce** tokens: a scan or submission with a missing, unknown or someone else's token is INVALID. Everyone not in the snapshot (live and webform sign-ups) gets our HMAC token. Earlier builds matched by `user_id` and only flagged `token_match=false`; that let a known id with a forged token earn a certificate.
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
- **Certificate:** a real PDF (`src/pdf.js`, `src/templates.js`), generated in the Code node with no library and no outside service. It shows name, project, date, verification ID, a verify URL, and the attendee's actual path drawn as three n8n-style nodes (Registered, Attended, Completed) with timestamps. n8n coral is the only accent color.
- **Notion dashboard (optional):** after the Sheets writes, changed attendees are mirrored into an `EventFlow Attendees` database (matched by User ID: update if the page exists, otherwise create) and every log row is added to `EventFlow Event Log`. Sheets stays the source of truth. The Notion database is read once per run, like the sheet. Notion errors continue past, so emails still go out, and if the read fails the sync is skipped instead of creating duplicate pages. Request bodies are built in `src/notion.js` and tested; `npm run notion:setup` creates both databases on a page.
- **Badge:** a square SVG "Verified Finisher" badge (name, event, date, verification ID) attached next to the PDF. Dates on the certificate, badge and verify page print in Manila time (UTC+8).
- **Delivery is confirmed, not assumed.** Gmail failures leave by the error output; `Record Pass Sent` / `Record Certificate Sent` stamp `pass_sent_at` / `certificate_sent_at` only after a send, and the engine re-queues anything unconfirmed 10 minutes after `email_queued_at`.
- **Certificate guard is exact:** only status `Attended` with a `checked_in_at` can complete, so a hand-edited status cannot mint a credential.
- **More intakes and outputs:** a registration webform (`/form/register`), a key-protected live webhook that replies with the verdict, a public `GET /webhook/verify?id=` page, and a `Funnel` tab row per run.
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

- Two scans of the same token in the same instant through the live webhook can both read Registered. State stays correct (both write Attended) but two OK log rows appear.
- The secret sits in the `Event Settings` node, so it shows on the canvas. Hand in `dist/eventflow-submission.json`, which replaces it (and the sheet id and demo inbox) with placeholders.
- The verify link needs `n8nBaseUrl` in `config/local.json` to point at the instance running the workflow.
- Notion is a one-way copy. Edits made in Notion never reach the sheet and are overwritten on the attendee's next change. Board and filtered views are made by hand once, because the Notion API cannot create views. Re-running a batch adds the DUPLICATE rows to the Notion log too, as it does in the sheet.
- Not done: Airtable, a reset flow. Code review and security review were skipped to make the deadline.
