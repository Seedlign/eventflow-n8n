// minimal PDF 1.4 writer: one page, one JPEG background, embedded TrueType fonts, so a Code node needs no library or browser

// embedded fonts use WinAnsi, so anything outside Latin-1 degrades to '?' instead of corrupting the stream
function pdfText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function fromBase64(b64) {
  return typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('latin1') : atob(b64);
}

function pdfBase64(binary) {
  return typeof Buffer !== 'undefined' ? Buffer.from(binary, 'latin1').toString('base64') : btoa(binary);
}

function hexColor(hex) {
  var n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (c) { return (c / 255).toFixed(3); }).join(' ');
}

// width in px of s set in font f at size px with letter-spacing ls px; letter-spacing follows every glyph, as in the browser
function textWidth(f, s, size, ls) {
  var w = 0;
  var str = String(s);
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    w += (c >= 32 && c <= 255 ? f.widths[c - 32] : f.widths['?'.charCodeAt(0) - 32]) * size / 1000 + (ls || 0);
  }
  return w;
}

// page is laid out in CSS px (the design's 1123x794) and mapped to A4 points
function pdfPage(widthPx, heightPx, background, fonts) {
  var k = 0.75;
  var H = heightPx * k;
  var ops = ['q ' + (widthPx * k).toFixed(2) + ' 0 0 ' + H.toFixed(2) + ' 0 0 cm /Bg Do Q'];
  return {
    text: function (xPx, baselinePx, fontKey, sizePx, hex, s, lsPx) {
      ops.push('BT /' + fontKey + ' ' + (sizePx * k).toFixed(2) + ' Tf ' + ((lsPx || 0) * k).toFixed(3) + ' Tc ' + hexColor(hex) + ' rg '
        + (xPx * k).toFixed(2) + ' ' + (H - baselinePx * k).toFixed(2) + ' Td (' + pdfText(s) + ') Tj ET');
    },
    build: function () { return pdfDoc(widthPx * k, H, ops.join('\n'), background, fonts); },
  };
}

function pdfDoc(width, height, content, background, fonts) {
  var objs = [];
  var add = function (body) { objs.push(body); return objs.length; };
  var catalog = add('');
  var pages = add('');
  var page = add('');
  var contents = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
  var jpeg = fromBase64(background.b64);
  var image = add('<< /Type /XObject /Subtype /Image /Width ' + background.w + ' /Height ' + background.h
    + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n' + jpeg + '\nendstream');
  var fontRefs = Object.keys(fonts).map(function (key) {
    var f = fonts[key];
    var file = fromBase64(f.b64);
    var fileRef = add('<< /Length ' + file.length + ' /Length1 ' + file.length + ' >>\nstream\n' + file + '\nendstream');
    var desc = add('<< /Type /FontDescriptor /FontName /' + f.name + ' /Flags 32 /FontBBox [' + f.bbox.join(' ') + '] /ItalicAngle 0 /Ascent ' + f.ascent
      + ' /Descent ' + f.descent + ' /CapHeight ' + f.cap + ' /StemV 80 /FontFile2 ' + fileRef + ' 0 R >>');
    var font = add('<< /Type /Font /Subtype /TrueType /BaseFont /' + f.name + ' /FirstChar 32 /LastChar 255 /Widths [' + f.widths.join(' ')
      + '] /Encoding /WinAnsiEncoding /FontDescriptor ' + desc + ' 0 R >>');
    return '/' + key + ' ' + font + ' 0 R';
  });
  objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pages + ' 0 R >>';
  objs[pages - 1] = '<< /Type /Pages /Kids [' + page + ' 0 R] /Count 1 >>';
  objs[page - 1] = '<< /Type /Page /Parent ' + pages + ' 0 R /MediaBox [0 0 ' + width.toFixed(2) + ' ' + height.toFixed(2) + '] /Contents ' + contents
    + ' 0 R /Resources << /XObject << /Bg ' + image + ' 0 R >> /Font << ' + fontRefs.join(' ') + ' >> >> >>';
  var out = '%PDF-1.4\n';
  var offsets = [];
  objs.forEach(function (body, i) {
    offsets.push(out.length);
    out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  var xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
    + offsets.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('')
    + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return out;
}
