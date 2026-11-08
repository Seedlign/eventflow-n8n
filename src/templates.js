var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

var CSS = { ink: '#1f2028', muted: '#666873', rule: '#dddee4', ground: '#f5f5f7', coral: '#ea4b71' };

function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// the event runs in Manila (UTC+8, no daylight saving), so dates print there whatever the n8n instance's timezone
var EVENT_UTC_OFFSET_HOURS = 8;

function manila(iso) {
  var t = new Date(iso).getTime();
  return isNaN(t) ? null : new Date(t + EVENT_UTC_OFFSET_HOURS * 3600000);
}

function longDate(iso) {
  var d = manila(iso);
  if (!d) return '';
  return MONTHS[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + d.getUTCFullYear();
}

function shortStamp(iso) {
  var d = manila(iso);
  if (!d) return '';
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return MONTHS[d.getUTCMonth()].slice(0, 3) + ' ' + d.getUTCDate() + ', ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' PHT';
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

function verifyUrl(a, settings) {
  return (settings.verify_base_url || '') + encodeURIComponent(a.verification_id);
}

// what /webhook/verify answers; row is findCredential's result, null when the id vouches for nothing
function verificationPage(row, id, eventName) {
  var body = row
    ? '<div style="font-size:12px;font-weight:700;letter-spacing:0.6px;color:' + CSS.coral + '">VALID CREDENTIAL</div>'
      + '<h1 style="font-size:26px;line-height:1.25;margin:8px 0 4px">' + escapeHtml(row.full_name) + '</h1>'
      + '<p style="margin:0 0 20px;font-size:15px;line-height:1.6">Checked in and submitted ' + escapeHtml(row.project_name)
      + ' at ' + escapeHtml(eventName) + '.</p>'
      + '<div style="font-size:12px;color:' + CSS.muted + '">Completed</div><div style="font-weight:600;margin:4px 0 12px">' + longDate(row.completed_at) + '</div>'
    : '<div style="font-size:12px;font-weight:700;letter-spacing:0.6px;color:' + CSS.muted + '">NOT VERIFIED</div>'
      + '<h1 style="font-size:26px;line-height:1.25;margin:8px 0 12px">Not a valid credential</h1>'
      + '<p style="margin:0 0 20px;font-size:15px;line-height:1.6">No completed attendee of ' + escapeHtml(eventName) + ' holds this verification ID.</p>';
  var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + (row ? 'Valid credential' : 'Not a valid credential') + '</title></head><body style="margin:0">'
    + emailShell(body + '<div style="font-size:12px;color:' + CSS.muted + '">Verification ID</div>'
      + '<div style="font-family:\'Courier New\',Courier,monospace;font-weight:700;margin-top:4px;word-break:break-all">' + escapeHtml(id) + '</div>',
    'Issued by EventFlow on n8n')
    + '</body></html>';
  return { valid: !!row, html: html };
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
  put('verifyUrl', verifyUrl(a, settings).replace(/^https?:\/\//, ''));
  return page.build();
}

function certificate(a, settings, originalEmail) {
  var body = '<h1 style="font-size:24px;line-height:1.25;letter-spacing:-0.3px;margin:8px 0 4px;font-weight:700">Your certificate of completion</h1>'
    + '<p style="margin:0 0 24px;font-size:15px;line-height:1.6">' + escapeHtml(a.full_name) + ', your check-in and your project ' + escapeHtml(a.project_name) + ' are verified. Your certificate (PDF) and a shareable badge (SVG) are attached.</p>'
    + '<div style="border-top:1px solid ' + CSS.rule + ';padding-top:16px">'
    + '<div style="font-size:12px;color:' + CSS.muted + '">Verification ID</div>'
    + '<div style="font-family:\'Courier New\',Courier,monospace;font-size:20px;font-weight:700;letter-spacing:1px;color:' + CSS.coral + ';margin:4px 0 12px">' + escapeHtml(a.verification_id) + '</div>'
    + '<div style="font-size:12px;color:' + CSS.muted + '">Completed</div>'
    + '<div style="font-size:15px;font-weight:600;margin-top:4px">' + longDate(a.completed_at) + '</div>'
    + '<p style="margin:20px 0 0;font-size:13px;line-height:1.6"><a href="' + escapeHtml(verifyUrl(a, settings)) + '" style="color:' + CSS.coral + '">Verify this certificate</a></p>'
    + '</div>';
  return {
    subject: 'Your certificate of completion: ' + settings.event_name,
    html: emailShell(body, 'Issued to ' + escapeHtml(originalEmail)),
    attachment: { fileName: 'certificate-' + a.user_id + '.pdf', mimeType: 'application/pdf', base64: pdfBase64(certificatePdf(a, settings)) },
    badge: { fileName: 'badge-' + a.user_id + '.svg', mimeType: 'image/svg+xml', base64: utf8Base64(badgeSvg(a, settings)) },
  };
}

function utf8Base64(s) {
  return typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)));
}

// square digital badge for profiles and posts; vector, so it stays sharp at any size and needs no image library
function badgeSvg(a, settings) {
  var name = String(a.full_name || '');
  var nameSize = name.length > 26 ? 26 : name.length > 18 ? 32 : 40;
  var t = function (x, y, size, weight, fill, s, extra) {
    return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-size="' + size + '" font-weight="' + weight + '" fill="' + fill + '"'
      + (extra || '') + '>' + escapeHtml(s) + '</text>';
  };
  return '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600" font-family="Helvetica, Arial, sans-serif">'
    + '<rect width="600" height="600" rx="48" fill="' + CSS.ink + '"/>'
    + '<circle cx="300" cy="300" r="250" fill="none" stroke="' + CSS.coral + '" stroke-width="10"/>'
    + '<circle cx="300" cy="300" r="226" fill="none" stroke="#ffffff" stroke-opacity="0.15" stroke-width="2"/>'
    + t(300, 150, 18, 700, '#ffffff', 'n8n PHILIPPINES USER GROUP', ' letter-spacing="2" fill-opacity="0.7"')
    + t(300, 220, 30, 700, CSS.coral, 'VERIFIED FINISHER', ' letter-spacing="3"')
    + '<line x1="200" y1="248" x2="400" y2="248" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/>'
    + t(300, 312, nameSize, 700, '#ffffff', name)
    + t(300, 352, 17, 400, '#ffffff', settings.event_name, ' fill-opacity="0.8"')
    + t(300, 410, 16, 400, '#ffffff', 'Registered  >  Attended  >  Completed', ' fill-opacity="0.6"')
    + t(300, 448, 16, 600, '#ffffff', longDate(a.completed_at))
    + t(300, 478, 15, 700, CSS.coral, a.verification_id, ' font-family="Courier New, Courier, monospace" letter-spacing="1"')
    + '</svg>';
}

function renderEmail(email, settings) {
  return email.kind === 'certificate'
    ? certificate(email.attendee, settings, email.original_email)
    : entryPass(email.attendee, settings, email.original_email);
}
