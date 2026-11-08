var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// one accent (n8n coral) on the single thing that matters per view; everything else is one cool neutral family
var INK = [0.122, 0.125, 0.157];
var MUTED = [0.400, 0.408, 0.451];
var RULE = [0.867, 0.871, 0.894];
var CORAL = [0.918, 0.294, 0.443];
var WHITE = [1, 1, 1];
// three nodes plus two connectors span the full 714pt content width, so the row ends on the rule line
var NODE_W = 202, NODE_GAP = 54, NODE_STEP = NODE_W + NODE_GAP;
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

// greedy wrap by character budget; Helvetica has no metrics here, so the budget is set conservatively
function wrapWords(s, max) {
  var lines = [''];
  String(s).split(/\s+/).forEach(function (w) {
    var cur = lines[lines.length - 1];
    if (cur && (cur + ' ' + w).length > max) lines.push(w);
    else lines[lines.length - 1] = cur ? cur + ' ' + w : w;
  });
  return lines;
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

function lifecycleNode(c, x, y, label, stamp, done) {
  c.node(x, y, NODE_W, 58, 8, done ? CORAL : WHITE, done ? null : RULE);
  c.text(x + 16, y + 34, 'B', 12, done ? WHITE : INK, label);
  c.text(x + 16, y + 16, 'R', 10, done ? WHITE : MUTED, stamp);
}

function certificatePdf(a, settings) {
  var W = 842, H = 595, L = 64;
  var c = pdfCanvas();
  c.rect(0, 0, W, H, WHITE);
  c.text(L, 523, 'B', 11, MUTED, 'n8n Philippines User Group', 0.6);
  c.text(L, 506, 'R', 11, MUTED, settings.event_name);

  c.text(L, 430, 'R', 15, INK, 'Certificate of completion');
  var nameSize = a.full_name.length > 26 ? 36 : 48;
  c.text(L, 372, 'B', nameSize, INK, a.full_name, -1);
  var y = 338;
  wrapWords('Checked in and submitted ' + a.project_name + '.', 72).slice(0, 2).forEach(function (line) {
    c.text(L, y, 'R', 15, INK, line);
    y -= 21;
  });

  // the attendee's actual path through the workflow, drawn the way n8n draws connected nodes
  var nodeY = 196;
  c.line(L + NODE_W, nodeY + 29, L + NODE_STEP, nodeY + 29, RULE, 1.5);
  c.line(L + NODE_STEP + NODE_W, nodeY + 29, L + 2 * NODE_STEP, nodeY + 29, RULE, 1.5);
  lifecycleNode(c, L, nodeY, 'Registered', shortStamp(a.registered_at), false);
  lifecycleNode(c, L + NODE_STEP, nodeY, 'Attended', shortStamp(a.checked_in_at), false);
  lifecycleNode(c, L + 2 * NODE_STEP, nodeY, 'Completed', shortStamp(a.completed_at), true);

  c.line(L, 150, W - L, 150, RULE, 0.75);
  var cols = [
    [L, 'Date', 'B', longDate(a.completed_at)],
    [L + NODE_STEP, 'Verification ID', 'M', a.verification_id],
  ];
  cols.forEach(function (col) {
    c.text(col[0], 118, 'R', 9, MUTED, col[1], 0.4);
    c.text(col[0], 98, col[2], 13, INK, col[3]);
  });
  // a full webhook URL is wider than the column, so the host and the path get a line each
  var url = verifyUrl(a, settings).replace(/^https?:\/\//, '');
  var slash = url.indexOf('/');
  c.text(L + 2 * NODE_STEP, 118, 'R', 9, MUTED, 'Verify at', 0.4);
  c.text(L + 2 * NODE_STEP, 98, 'R', 9, INK, slash < 0 ? url : url.slice(0, slash));
  if (slash >= 0) c.text(L + 2 * NODE_STEP, 86, 'R', 9, INK, url.slice(slash));
  return pdfDoc(W, H, c.toString());
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
