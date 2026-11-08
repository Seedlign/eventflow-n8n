var settings = $('Event Settings').first().json;
var rows = $input.all().map(function (i) { return i.json; }).filter(function (r) { return r && r.user_id; });
var now = new Date().toISOString();
var result = runBatch(sortedEvents(settings), rows, settings, now);

var out = [];
result.attendees.forEach(function (r) { out.push({ json: Object.assign({ action: 'attendee' }, r) }); });
result.log.forEach(function (l) { out.push({ json: Object.assign({ action: 'log' }, l) }); });
result.emails.forEach(function (e) {
  var m = renderEmail(e, settings);
  var item = { json: { action: e.kind, to: e.to, original_email: e.original_email, user_id: e.attendee.user_id, subject: m.subject, html: m.html } };
  if (m.attachment) item.binary = { certificate: { data: m.attachment.base64, mimeType: m.attachment.mimeType, fileName: m.attachment.fileName } };
  if (m.badge) item.binary.badge = { data: m.badge.base64, mimeType: m.badge.mimeType, fileName: m.badge.fileName };
  out.push(item);
});
// flat counts so Append Funnel Snapshot can write one row per run
var s = result.summary;
var count = function (k) { return s.outcomes[k] || 0; };
out.push({ json: Object.assign({ action: 'summary' }, s, {
  registered: s.funnel.registered, attended: s.funnel.attended, completed: s.funnel.completed,
  ok: count('OK'), duplicate: count('DUPLICATE'), unverified: count('UNVERIFIED'), invalid: count('INVALID'),
}) });
return out;
