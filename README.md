# EventFlow

## Main feature

Rule-based event lifecycle automation on n8n for the n8n Philippines User Group (Hack with the Flow Buildathon finals, Track D). It registers attendees with a token, checks them in only against that token, and emails a PDF certificate and a shareable badge only to people who both checked in and submitted a project.

## Functionalities

- Three intakes into one engine: the organizer batch (`GET /webhook/TrackDData`), live events (`POST /webhook/eventflow-live`, header `X-EventFlow-Key`) and a registration webform (`/form/register`).
- Walks events in sequence against the `Attendees` sheet: Registered, Attended, Completed, with DUPLICATE, UNVERIFIED and INVALID outcomes decided from sheet state, never from the event label.
- Check-ins and submissions are authorised by the **token**. A missing, unknown or someone else's token is INVALID.
- Registration reuses the token the organizer snapshot already issued for that email; everyone else gets `N8NPH-` + HMAC-SHA256 of the user_id with the event secret, re-derived on a collision. Webform sign-ups get `REG-` + SHA-256 of the email, and an email already on file is DUPLICATE.
- A certificate needs status exactly `Attended` and a `checked_in_at`; anything else, including a hand-edited status, is UNVERIFIED.
- Emails an entry pass (token + QR code), and a PDF certificate plus a square SVG badge with name, Manila-time date, verification ID and the attendee's lifecycle timestamps.
- Gmail failures leave by the node's error output. Only a delivered email stamps `pass_sent_at` / `certificate_sent_at`; anything unconfirmed 10 minutes after `email_queued_at` is sent again on the next run.
- `GET /webhook/verify?id=VER-...`, the link printed on every certificate, answers whether that ID belongs to a Completed attendee.
- Live calls get the verdict back as JSON; every run appends its counts to the `Funnel` tab and logs every event to `EventLog` with a reason.
- Re-running the same batch changes nothing and sends nothing.
- Optional Notion dashboard: mirrors attendees and every log entry into two Notion databases, after batch runs and live calls.

## Tech stack & dependencies

- n8n (cloud), with HTTP Request, Webhook, Form Trigger, Set, Code, Switch, If, Respond to Webhook, Google Sheets and Gmail nodes.
- Google Sheets as the attendee database (`Attendees`, `EventLog` and `Funnel` tabs).
- Notion (optional) as the event dashboard, written by the Notion node and HTTP Request nodes.
- Node.js 22 for the build script and tests (`node --test`), with no npm dependencies.

## Installation

1. `git clone https://github.com/Seedlign/eventflow-n8n.git && cd eventflow-n8n`
2. `npm test`
3. `npm run build`. The first run creates `config/local.json` with a random secret; fill in `sheetId`, `demoRecipient` and `n8nBaseUrl` (the instance the workflow runs on, e.g. `https://khylepanganiban.app.n8n.cloud`), then run it again. It writes `dist/eventflow.json` and `dist/eventflow-submission.json` (secret, sheet id and demo inbox replaced by `REPLACE_*`, safe to hand in).
4. Create a Google Sheet with these tabs and headers:
   - `Attendees`: user_id, full_name, email, organization, role, token, status, registered_at, checked_in_at, submitted_at, project_name, repository_url, verification_id, completed_at, email_queued_at, pass_sent_at, certificate_sent_at
   - `EventLog`: log_id, run_at, sequence, event_type, intent, user_id, full_name, outcome, reason, from_status, to_status, token_presented, token_match
   - `Funnel`: run_at, source, events, registered, attended, completed, ok, duplicate, unverified, invalid, retries
5. Import `dist/eventflow.json` into n8n. Pick Google Sheets credentials on the six Sheets nodes and a Gmail credential on the two Gmail nodes, create a Header Auth credential (name `X-EventFlow-Key`, any long value) on **Live Event**, activate the workflow, then execute `Run Batch`.

Clear old rows before a demo run if they were written by an earlier build: they carry generated tokens instead of the snapshot ones, and rows with no `*_sent_at` will have their email sent again.

### Live webhook

`POST /webhook/eventflow-live` with header `X-EventFlow-Key` and one event, an array of events, or `{ "raw_incoming_payloads": [...] }`. A scan needs only the token. The response is the run summary: `results` holds each event's outcome, reason and status change, plus the funnel counts.

`curl -X POST https://<instance>/webhook/eventflow-live -H 'X-EventFlow-Key: <key>' -H 'Content-Type: application/json' -d '{"event_type":"checkin_scanned","token":"N8NPH-9Q0R1S2T"}'`

### Notion dashboard (optional)

1. At https://www.notion.so/profile/integrations create an internal integration and copy its secret.
2. Create an empty Notion page (for example "EventFlow Dashboard"), then in its `...` menu > Connections, add the integration.
3. `NOTION_TOKEN=<secret> npm run notion:setup -- <page URL>`. This adds an `EventFlow Attendees` and an `EventFlow Event Log` database to the page and saves their ids in `config/local.json`.
4. `npm run build` and re-import. Pick a Notion credential (same secret) on `Read Notion Attendees`, `Sync Notion Attendee` and `Append Notion Log`.
5. In Notion, add a Board view to `EventFlow Attendees` grouped by `Status` (the funnel), and a view of `EventFlow Event Log` filtered to `Outcome` is not `OK` (blocked attempts). The API cannot create views, so this step is by hand, once.

Without `notion` in the config, the build leaves the Notion nodes out.

## Expected run on the organizer batch

5 entry passes, 4 certificates with badges. Every check-in matches its pre-issued token. Seq 9 is DUPLICATE, seq 12 UNVERIFIED (submission before check-in), Kevin (REG-8005) stays Registered. Funnel 5 / 4 / 4: Angelica (REG-8004) ends Completed because her seq 15 submission follows her seq 13 check-in, where the organizer snapshot still shows her as Attended. A second run logs every event as DUPLICATE and sends nothing.

See `CONTEXT.md` for the problem, the design decisions and the results on the organizer data, and `docs/submission.md` for the assessment answers.
