var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

var CSS = { ink: '#1f2028', muted: '#666873', rule: '#dddee4', ground: '#f5f5f7', coral: '#ea4b71' };

function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// UTC so printed dates do not shift with the n8n instance's timezone
function longDate(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

function shortStamp(iso) {
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate() + ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
}

function emailShell(body, footer) {
  return '<div style="background:' + CSS.ground + ';padding:32px 16px;font-family:\'Open Sans\',Helvetica,Arial,sans-serif;color:' + CSS.ink + '">'
    + '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid ' + CSS.rule + ';border-radius:12px;padding:32px 32px 36px">'
    + '<div style="font-size:12px;font-weight:600;letter-spacing:0.6px;color:' + CSS.muted + '">n8n Philippines User Group</div>'
    + body
    + '</div>'
    + '<div style="max-width:520px;margin:12px auto 0;font-size:12px;color:' + CSS.muted + '">' + footer + '</div>'
    + '</div>';
}

function entryPass(a, settings, originalEmail) {
  var qr = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=' + encodeURIComponent(a.token);
  var body = '<h1 style="font-size:24px;line-height:1.25;letter-spacing:-0.3px;margin:8px 0 4px;font-weight:700">Your entry pass</h1>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6">' + escapeHtml(a.full_name) + ', show this at the check-in desk for ' + escapeHtml(settings.event_name) + '.</p>'
    + '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>'
    + '<td style="padding:0 24px 0 0;vertical-align:top"><img src="' + qr + '" width="140" height="140" alt="QR code for ' + escapeHtml(a.token) + '" style="display:block;border-radius:6px"></td>'
    + '<td style="vertical-align:top">'
    + '<div style="font-size:12px;color:' + CSS.muted + '">Check-in code</div>'
    + '<div style="font-family:\'Courier New\',Courier,monospace;font-size:24px;font-weight:700;letter-spacing:1px;color:' + CSS.coral + ';margin:4px 0 16px">' + escapeHtml(a.token) + '</div>'
    + '<div style="font-size:12px;color:' + CSS.muted + '">Attendee ID</div>'
    + '<div style="font-size:15px;font-weight:600;margin-top:4px">' + escapeHtml(a.user_id) + '</div>'
    + '</td></tr></table>'
    + '<p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:' + CSS.muted + '">No QR scanner at the desk? Read out the code.</p>';
  return {
    subject: 'Your entry pass for ' + settings.event_name + ' (' + a.token + ')',
    html: emailShell(body, 'Registered as ' + escapeHtml(originalEmail)),
    attachment: null,
  };
}

// per-person text over the design handoff's background; positions are the browser layout of certificate.template.html in px
var CERT_TEXT = {
  recipient: { x: 100, base: 366.8, font: 'N', size: 96, color: '#1B1B26', ls: -2.4 },
  statement: { x: 100, base: 428.8, font: 'S', size: 17, color: '#4A4A5A', maxWidth: 620, lineHeight: 26.35 },
  registeredAt: { x: 146.6, base: 604, font: 'T', size: 12, color: '#6B6B7B' },
  attendedAt: { x: 472.9, base: 604, font: 'T', size: 12, color: '#6B6B7B' },
  completedAt: { x: 799.3, base: 604, font: 'T', size: 12, color: '#6B6B7B' },
  date: { x: 100, base: 718, font: 'D', size: 14, color: '#1B1B26' },
  verificationId: { x: 370.6, base: 716, font: 'I', size: 13, color: '#1B1B26' },
  verifyUrl: { right: 1023, base: 716, font: 'I', size: 13, color: '#C93A5E' },
};

function wrapToWidth(f, s, size, maxWidth) {
  var lines = [''];
  String(s).split(/\s+/).forEach(function (w) {
    var cur = lines[lines.length - 1];
    var next = cur ? cur + ' ' + w : w;
    if (cur && textWidth(f, next, size, 0) > maxWidth) lines.push(w);
    else lines[lines.length - 1] = next;
  });
  return lines;
}

function certificatePdf(a, settings) {
  var page = pdfPage(1123, 794, CERT_BG_JPEG, CERT_FONTS);
  var put = function (key, value, size) {
    var t = CERT_TEXT[key];
    var sz = size || t.size;
    var x = t.right ? t.right - textWidth(CERT_FONTS[t.font], value, sz, t.ls) : t.x;
    page.text(x, t.base, t.font, sz, t.color, value, t.ls);
  };
  // handoff rule: about 22 characters fit at 96px, then scale down with a 60px floor
  var name = String(a.full_name);
  put('recipient', name, Math.max(60, Math.min(96, 96 * 22 / Math.max(name.length, 1))));
  var st = CERT_TEXT.statement;
  wrapToWidth(CERT_FONTS[st.font], 'Checked in and submitted ' + a.project_name + '.', st.size, st.maxWidth).slice(0, 2).forEach(function (line, i) {
    page.text(st.x, st.base + i * st.lineHeight, st.font, st.size, st.color, line, 0);
  });
  put('registeredAt', shortStamp(a.registered_at));
  put('attendedAt', shortStamp(a.checked_in_at));
  put('completedAt', shortStamp(a.completed_at));
  put('date', longDate(a.completed_at));
  put('verificationId', a.verification_id);
  put('verifyUrl', (settings.verify_base_url || '').replace(/^https?:\/\//, '') + a.verification_id);
  return page.build();
}

function certificate(a, settings, originalEmail) {
  var body = '<h1 style="font-size:24px;line-height:1.25;letter-spacing:-0.3px;margin:8px 0 4px;font-weight:700">Your certificate of completion</h1>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6">' + escapeHtml(a.full_name) + ', your check-in and your project ' + escapeHtml(a.project_name) + ' are verified. The certificate is attached as a PDF.</p>'
    + '<div style="border-top:1px solid ' + CSS.rule + ';padding-top:16px">'
    + '<div style="font-size:12px;color:' + CSS.muted + '">Verification ID</div>'
    + '<div style="font-family:\'Courier New\',Courier,monospace;font-size:20px;font-weight:700;letter-spacing:1px;color:' + CSS.coral + ';margin:4px 0 12px">' + escapeHtml(a.verification_id) + '</div>'
    + '<div style="font-size:12px;color:' + CSS.muted + '">Completed</div>'
    + '<div style="font-size:15px;font-weight:600;margin-top:4px">' + longDate(a.completed_at) + '</div>'
    + '</div>';
  return {
    subject: 'Your certificate of completion: ' + settings.event_name,
    html: emailShell(body, 'Issued to ' + escapeHtml(originalEmail)),
    attachment: { fileName: 'certificate-' + a.user_id + '.pdf', mimeType: 'application/pdf', base64: pdfBase64(certificatePdf(a, settings)) },
  };
}

function renderEmail(email, settings) {
  return email.kind === 'certificate'
    ? certificate(email.attendee, settings, email.original_email)
    : entryPass(email.attendee, settings, email.original_email);
}
