// minimal PDF 1.4 writer: one page, the three standard fonts, vector shapes only, so a Code node needs no library
var PDF_FONTS = { R: 'Helvetica', B: 'Helvetica-Bold', M: 'Courier-Bold' };

// standard fonts use WinAnsi, so anything outside Latin-1 degrades to '?' instead of corrupting the stream
function pdfText(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[^\x20-\xff]/g, '?')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function pdfColor(rgb, stroke) {
  return rgb.map(function (c) { return c.toFixed(3); }).join(' ') + (stroke ? ' RG' : ' rg');
}

function pdfDoc(width, height, content) {
  var fontKeys = Object.keys(PDF_FONTS);
  var objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height + '] /Contents 4 0 R /Resources << /Font << '
      + fontKeys.map(function (k, i) { return '/' + k + ' ' + (5 + i) + ' 0 R'; }).join(' ') + ' >> >> >>',
    '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream',
  ].concat(fontKeys.map(function (k) {
    return '<< /Type /Font /Subtype /Type1 /BaseFont /' + PDF_FONTS[k] + ' /Encoding /WinAnsiEncoding >>';
  }));
  var out = '%PDF-1.4\n';
  var offsets = [];
  objs.forEach(function (body, i) {
    offsets.push(out.length);
    out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  var xref = out.length;
  out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n'
    + offsets.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('')
    + 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
  return out;
}

// small drawing vocabulary over the content stream
function pdfCanvas() {
  var ops = [];
  return {
    text: function (x, y, font, size, rgb, s, tracking) {
      ops.push('BT /' + font + ' ' + size + ' Tf ' + (tracking || 0) + ' Tc ' + pdfColor(rgb) + ' ' + x + ' ' + y + ' Td (' + pdfText(s) + ') Tj ET');
    },
    rect: function (x, y, w, h, fill) {
      ops.push(pdfColor(fill) + ' ' + x + ' ' + y + ' ' + w + ' ' + h + ' re f');
    },
    line: function (x1, y1, x2, y2, rgb, width) {
      ops.push(pdfColor(rgb, true) + ' ' + width + ' w ' + x1 + ' ' + y1 + ' m ' + x2 + ' ' + y2 + ' l S');
    },
    // rounded rectangle like an n8n canvas node; fill and/or stroke
    node: function (x, y, w, h, r, fill, stroke) {
      var k = (r * 0.5523).toFixed(2);
      var p = [x + r, y, 'm', x + w - r, y, 'l', x + w - r + +k, y, x + w, y + r - k, x + w, y + r, 'c',
        x + w, y + h - r, 'l', x + w, y + h - r + +k, x + w - r + +k, y + h, x + w - r, y + h, 'c',
        x + r, y + h, 'l', x + r - k, y + h, x, y + h - r + +k, x, y + h - r, 'c',
        x, y + r, 'l', x, y + r - k, x + r - k, y, x + r, y, 'c'].join(' ');
      ops.push((fill ? pdfColor(fill) + ' ' : '') + (stroke ? pdfColor(stroke, true) + ' 1 w ' : '') + p + ' h ' + (fill && stroke ? 'B' : fill ? 'f' : 'S'));
    },
    toString: function () { return ops.join('\n'); },
  };
}

function pdfBase64(binary) {
  return typeof Buffer !== 'undefined' ? Buffer.from(binary, 'latin1').toString('base64') : btoa(binary);
}
