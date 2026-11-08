# EventFlow: End-to-End Event Lifecycle Automation & Verified Credential Dispatcher

Track D, Hack with the Flow: n8n Buildathon finals.

## Workflow Image

![EventFlow workflow](workflow.png)

Three intakes feed one engine: the organizer HTTP Request (`GET /webhook/TrackDData`), the live webhook (`POST /webhook/eventflow-live`) and a registration webform (`/form/register`). After Read Attendees (Google Sheets), one Code node runs the state machine. A Switch routes its output to the Attendees upsert, the EventLog append, the entry-pass and certificate Gmail nodes, a Funnel snapshot and the live webhook reply. A separate public `GET /webhook/verify` checks any issued certificate.

## Assessment Questions

### 1. How does the workflow stop participants from skipping funnel steps, and how are duplicate check-ins handled?

The event label (`project_submitted`, `checkin_scanned`, …) is only treated as an intent. What happens is decided by the attendee's current row in Google Sheets:

- **Check-ins and submissions are authorised by the attendee's token, not the `user_id`.** A missing token, a token not on file, or a token that belongs to a different attendee is logged as INVALID and changes nothing. Knowing someone's `user_id` is not enough to check them in or claim their certificate.
- **A certificate is issued only when the status is exactly `Attended` and there is a `checked_in_at` time.** A submission from a `Registered` row is UNVERIFIED (sequence 12 in the organizer batch). So is any status that isn't one of the three expected values, such as a hand-edited `attended`. Nothing is sent in either case.
- **Duplicate check-ins:** if the row is already `Attended` or `Completed`, the scan is logged as DUPLICATE, with the time of the first check-in, and the row is not changed (sequence 9). A second submission from a `Completed` row is DUPLICATE and no second certificate is issued.
- Events are processed in `sequence` order against the state left by the events before them, so a check-in and a duplicate scan inside the same batch are still told apart.
- Every attempt, accepted or not, is appended to **EventLog** with its outcome, reason, status before and after, and whether the token matched.
- Re-running the whole batch changes nothing and sends nothing: all 15 events come back DUPLICATE.
- Known limit: two scans of the same token in the same instant through the live webhook can both read `Registered`. Both write the same `Attended` row, so the attendee's state stays correct, but two OK rows appear in the log.

### 2. How are unique check-in tokens generated, and how does downstream logic validate them against Google Sheets in real time?

- **Generation (Code node):** `N8NPH-` followed by the first 8 hex characters of HMAC-SHA256(event secret, `token|user_id`).
  - SHA-256 and HMAC are written in plain JavaScript inside the Code node, so the node doesn't need the `crypto` module. Tests check them against Node's crypto.
  - Tokens can't be forged without the event secret.
  - Before a token is issued, it's checked against every token on file. On a collision it's re-derived with an attempt counter, so no two attendees share a token.
- **Pre-issued tokens:** the organizer's snapshot already printed tokens on passes, so registration reuses the snapshot's token for that email if nobody else holds it. That's why every organizer scan matches.
- **Webform sign-ups:** registrations without a `user_id` get `REG-` plus 8 hex characters of SHA-256(email), and an email that's already registered, in any letter case, is DUPLICATE.
- **Validation:** each execution starts with **Read Attendees** (Google Sheets), which loads the tab once. The engine looks rows up by token in memory and checks every scan and submission against it.
  - Changed rows are written back by **Upsert Attendee** (Google Sheets append-or-update matched on `user_id`).
  - The live webhook replies to the scanner straight away with the outcome, the reason and the status change.

### 3. How is the certificate generated so it renders well on any device, and how is it attached in the Gmail node?

- **Certificate:** the Code node draws a one-page vector PDF (A4 landscape, standard PDF fonts, no library).
  - It shows the participant's full name, the completion date and the verification ID.
  - It also shows the attendee's own path as n8n-style connected nodes: Registered → Attended → Completed, each with its timestamp.
  - A PDF looks the same on phones, desktops and print.
  - Dates are printed in Manila time (UTC+8), whatever time zone the n8n instance uses.
  - Text is escaped, and characters the standard fonts can't draw fall back to `?` instead of breaking the PDF.
- **Badge:** a square SVG "Verified Finisher" badge with the name, event, date and verification ID. It's a vector file, so it stays sharp at any size and can be posted to profiles.
- **Email:** table-based HTML with inline styles, which works in every major email app. The entry pass carries the token as text and as a QR code.
- **Attaching:** the Code node outputs the PDF and badge as binary properties `certificate` and `badge`, and the Gmail node attaches both through *Attachments → `certificate,badge`*.
- **Delivery:** a Gmail failure goes to the node's error output instead of being counted as sent. **Record Certificate Sent** stamps `certificate_sent_at` only when a send succeeds. Any certificate not confirmed within 10 minutes is sent again on the next run.
- **Verification:** the "Verify at" link on every certificate opens this workflow's `/webhook/verify?id=VER-…` page, which confirms the certificate only if a Completed row holds that exact ID.
