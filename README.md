# EventFlow

Rule-based event lifecycle automation on n8n for the Hack with the Flow Buildathon finals, Track D (n8n Philippines User Group Event Manager). It registers attendees with a token, checks them in only against that token, and emails a verified PDF certificate only to people who both checked in and submitted.

## Flow

Organizer HTTP Request (`GET /webhook/TrackDData`), the live webhook (`POST /webhook/eventflow-live`) or the webform (`/form/register`) -> Event Settings -> Read Attendees -> Run Lifecycle Engine (Code) -> Route by Action (Switch) -> Upsert Attendee, Append Event Log, Send Entry Pass -> Record Pass Sent, Send Certificate -> Record Certificate Sent, and the summary -> Append Funnel Snapshot and Reply to Scanner (live calls only).

`GET /webhook/verify?id=VER-...` -> Read Credentials -> Render Verification -> an HTML page. This is the link printed on every certificate.

## Rules

- Check-ins and submissions are authorised by the **token**. A missing token, an unknown token, or a token that belongs to someone other than the `user_id` sent is INVALID.
- Registration reuses the token the organizer snapshot (`attendees_database_snapshot`) already issued for that email, as long as nobody else holds it. Everyone else gets `N8NPH-` plus HMAC-SHA256 of the user_id with the event secret.
- Registrations without a `user_id` (the webform) get `REG-` + SHA-256 of the email. An email already on file, in any case, is DUPLICATE. A generated token that collides with one on file is re-derived.
- A certificate needs status exactly `Attended` and a `checked_in_at`. Anything else, including a hand-edited status, is UNVERIFIED.
- Certificates are a PDF plus a square SVG badge, both attached by Send Certificate. Dates print in Manila time (UTC+8).
- Gmail failures leave by the node's error output. Only a delivered email stamps `pass_sent_at` / `certificate_sent_at`. Any row still owed an email more than 10 minutes after `email_queued_at` is sent again on the next run.

## Build and import

1. `npm test`
2. `npm run build` (first run creates `config/local.json` with a random secret; fill in `sheetId`, `demoRecipient` and `n8nBaseUrl`, e.g. `https://yourteam.app.n8n.cloud`, then build again)
3. Import `dist/eventflow.json` into n8n, pick Google Sheets and Gmail credentials on the six Sheets and two Gmail nodes, create a Header Auth credential (name `X-EventFlow-Key`, any long value) on **Live Event**, and activate the workflow so the webhooks and the form are live.
4. Hand in `dist/eventflow-submission.json`: the same workflow with the secret, sheet id and demo inbox replaced by `REPLACE_*` placeholders.

## Sheet

- `Attendees`: user_id, full_name, email, organization, role, token, status, registered_at, checked_in_at, submitted_at, project_name, repository_url, verification_id, completed_at, email_queued_at, pass_sent_at, certificate_sent_at
- `Funnel`: run_at, source, events, registered, attended, completed, ok, duplicate, unverified, invalid, retries
- `EventLog`: log_id, run_at, sequence, event_type, intent, user_id, full_name, outcome, reason, from_status, to_status, token_presented, token_match

Clear old rows before a demo run if they were written by an earlier build: they carry generated tokens instead of the snapshot ones, and rows with no `*_sent_at` will have their email sent again.

## Expected run on the organizer batch

5 entry passes, 4 certificates. Every check-in matches its pre-issued token. Seq 9 is DUPLICATE, seq 12 UNVERIFIED (submission before check-in), Kevin (REG-8005) stays Registered. Funnel 5 / 4 / 4: Angelica (REG-8004) ends Completed because her seq 15 submission follows her seq 13 check-in, where the organizer snapshot still shows her as Attended. A second run logs every event as DUPLICATE and sends nothing.

## Live webhook

`POST /webhook/eventflow-live` with header `X-EventFlow-Key` and one event, an array of events, or `{ "raw_incoming_payloads": [...] }`. A scan needs only `{ "event_type": "checkin_scanned", "token": "N8NPH-..." }`. The response is the run summary: `results` holds each event's outcome, reason and status change, plus the funnel counts.

Example: `curl -X POST https://<instance>/webhook/eventflow-live -H 'X-EventFlow-Key: <key>' -H 'Content-Type: application/json' -d '{"event_type":"checkin_scanned","token":"N8NPH-9Q0R1S2T"}'`

Submission answers: `docs/submission.md`.
