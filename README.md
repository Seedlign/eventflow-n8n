# EventFlow

## Main feature

Rule-based event lifecycle automation on n8n for the n8n Philippines User Group (Hack with the Flow Buildathon finals, Track D). It registers attendees with a signed token, checks them in, and emails a PDF certificate only to people who both checked in and submitted a project.

## Functionalities

- Pulls the organizer batch from `GET /webhook/TrackDData`, or takes single live events on `POST /webhook/eventflow-live`.
- Walks events in sequence against the `Attendees` sheet: Registered, Attended, Completed, with DUPLICATE, UNVERIFIED and INVALID outcomes decided from sheet state.
- Generates HMAC-SHA256 attendee tokens and certificate verification IDs in plain JS.
- Emails an entry pass with the token and a QR code, and a PDF certificate with name, project, date, verification ID and the attendee's lifecycle timestamps.
- Logs every event, accepted or not, to the `EventLog` sheet with a reason.
- Re-running the same batch changes nothing and sends nothing.

## Tech stack & dependencies

- n8n (cloud), with HTTP Request, Webhook, Set, Code, Switch, Google Sheets and Gmail nodes.
- Google Sheets as the attendee database (`Attendees` and `EventLog` tabs).
- Node.js 22 for the build script and tests (`node --test`), with no npm dependencies.

## Installation

1. `git clone https://github.com/Seedlign/eventflow-n8n.git && cd eventflow-n8n`
2. `npm test`
3. `npm run build`. The first run creates `config/local.json` with a random secret; fill in `sheetId` and `demoRecipient`, then run it again.
4. Create a Google Sheet with an `Attendees` tab (`user_id, full_name, email, organization, role, token, status, registered_at, checked_in_at, submitted_at, project_name, repository_url, verification_id, completed_at, token_match`) and an `EventLog` tab (`log_id, run_at, sequence, event_type, intent, user_id, full_name, outcome, reason, from_status, to_status, token_presented, token_match`).
5. Import `dist/eventflow.json` into n8n, pick Google Sheets credentials on the three Sheets nodes and a Gmail credential on the two Gmail nodes, then execute `Run Batch`.

See `CONTEXT.md` for the problem, the design decisions and the results on the organizer data.
