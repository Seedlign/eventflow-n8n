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
    [L + 2 * NODE_STEP, 'Verify at', 'R', (settings.verify_base_url || '').replace(/^https?:\/\//, '') + a.verification_id],
  ];
  cols.forEach(function (col) {
    c.text(col[0], 118, 'R', 9, MUTED, col[1], 0.4);
    c.text(col[0], 98, col[2], col[2] === 'R' ? 9 : 13, INK, col[3]);
  });
  return pdfDoc(W, H, c.toString());
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
