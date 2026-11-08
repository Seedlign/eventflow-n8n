var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// UTC so the printed date does not shift with the n8n instance's timezone
function longDate(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

function toBase64(s) {
  return typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)));
}

function emailShell(title, body, footer) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f6;padding:24px">'
    + '<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e2e8">'
    + '<div style="background:#1f1f2e;color:#ffffff;padding:20px 24px;font-size:18px;font-weight:bold">' + title + '</div>'
    + '<div style="padding:24px;color:#22222a;font-size:15px;line-height:1.5">' + body + '</div>'
    + '<div style="padding:12px 24px;background:#fafafc;color:#6b6b78;font-size:12px">' + footer + '</div>'
    + '</div></div>';
}

function entryPass(a, settings, originalEmail) {
  var qr = 'https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(a.token);
  var body = '<p>Hi ' + escapeHtml(a.full_name) + ',</p>'
    + '<p>You are registered for <b>' + escapeHtml(settings.event_name) + '</b>. Show this pass at the check-in desk.</p>'
    + '<div style="text-align:center;margin:24px 0">'
    + '<img src="' + qr + '" width="220" height="220" alt="QR code for ' + escapeHtml(a.token) + '">'
    + '<div style="font-family:Consolas,monospace;font-size:24px;letter-spacing:2px;margin-top:12px">' + escapeHtml(a.token) + '</div>'
    + '</div>'
    + '<p style="color:#6b6b78;font-size:13px">Attendee ID ' + escapeHtml(a.user_id) + '. If the QR code does not load, read the code above to the volunteer.</p>';
  return {
    subject: 'Your entry pass for ' + settings.event_name + ' (' + a.token + ')',
    html: emailShell('Entry pass', body, 'Registered as ' + escapeHtml(originalEmail)),
    attachment: null,
  };
}

function certificateDocument(a, settings) {
  var verifyUrl = (settings.verify_base_url || '') + a.verification_id;
  return '<!doctype html><html><head><meta charset="utf-8"><title>Certificate of Completion</title>'
    + '<style>body{margin:0;background:#eceaf2;font-family:Georgia,serif}'
    + '.c{width:900px;margin:40px auto;background:#fff;border:12px solid #1f1f2e;padding:56px 64px;text-align:center}'
    + 'h1{font-size:40px;letter-spacing:4px;margin:0 0 8px;color:#1f1f2e}.sub{color:#6b6b78;letter-spacing:2px}'
    + '.name{font-size:44px;margin:36px 0 8px;color:#22222a}.p{font-size:18px;color:#33333d}'
    + '.meta{display:flex;justify-content:space-between;margin-top:56px;font-family:Arial,sans-serif;font-size:14px;color:#33333d}'
    + '.id{font-family:Consolas,monospace}@media print{body{background:#fff}.c{margin:0}}</style></head><body><div class="c">'
    + '<h1>CERTIFICATE OF COMPLETION</h1><div class="sub">' + escapeHtml(settings.event_name) + '</div>'
    + '<div class="name">' + escapeHtml(a.full_name) + '</div>'
    + '<div class="p">checked in, built and submitted <b>' + escapeHtml(a.project_name) + '</b></div>'
    + '<div class="meta"><div>Date<br><b>' + longDate(a.completed_at) + '</b></div>'
    + '<div>Verification ID<br><b class="id">' + escapeHtml(a.verification_id) + '</b></div>'
    + '<div>Verify at<br><b>' + escapeHtml(verifyUrl) + '</b></div></div>'
    + '</div></body></html>';
}

function certificate(a, settings, originalEmail) {
  var body = '<p>Congratulations ' + escapeHtml(a.full_name) + ',</p>'
    + '<p>Your attendance and your project <b>' + escapeHtml(a.project_name) + '</b> are verified. Your certificate is attached; open it in a browser and print to PDF if you need a file.</p>'
    + '<p>Verification ID: <b style="font-family:Consolas,monospace">' + escapeHtml(a.verification_id) + '</b><br>Completed: ' + longDate(a.completed_at) + '</p>';
  return {
    subject: 'Your certificate of completion: ' + settings.event_name,
    html: emailShell('Certificate of completion', body, 'Issued to ' + escapeHtml(originalEmail)),
    attachment: { fileName: 'certificate-' + a.user_id + '.html', mimeType: 'text/html', base64: toBase64(certificateDocument(a, settings)) },
  };
}

function renderEmail(email, settings) {
  return email.kind === 'certificate'
    ? certificate(email.attendee, settings, email.original_email)
    : entryPass(email.attendee, settings, email.original_email);
}
