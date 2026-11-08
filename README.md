# EventFlow

Rule-based event lifecycle automation on n8n for the Hack with the Flow Buildathon finals, Track D (n8n Philippines User Group Event Manager). It registers attendees with an HMAC token, checks them in, and emails a verified certificate only to people who both checked in and submitted.

## Flow

Organizer HTTP Request (`GET /webhook/TrackDData`) or the live webhook (`POST /webhook/eventflow-live`) -> Event Settings -> Read Attendees -> Run Lifecycle Engine (Code) -> Route by Action (Switch) -> Upsert Attendee, Append Event Log, Send Entry Pass, Send Certificate.

## Build and import

1. `npm test`
2. `npm run build` (first run creates `config/local.json` with a random secret; fill in `sheetId` and `demoRecipient`, then build again)
3. Import `dist/eventflow.json` into n8n, pick Google Sheets and Gmail credentials on the four Sheets and two Gmail nodes.

## Sheet

- `Attendees`: user_id, full_name, email, organization, role, token, status, registered_at, checked_in_at, submitted_at, project_name, repository_url, verification_id, completed_at, token_match
- `EventLog`: log_id, run_at, sequence, event_type, intent, user_id, full_name, outcome, reason, from_status, to_status, token_presented, token_match

## Expected run on the organizer batch

5 entry passes, 4 certificates. Seq 9 is DUPLICATE, seq 12 UNVERIFIED (submission before check-in), Kevin (REG-8005) stays Registered. Funnel 5 / 4 / 4. A second run logs every event as DUPLICATE and sends nothing.
