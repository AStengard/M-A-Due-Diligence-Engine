/**
 * Standalone Zero-Dependency PDF Engine for Legal M&A Due Diligence.
 * Handles:
 * 1. Extraction of text from PDF contracts.
 * 2. Generation of high-fidelity, multi-page executive PDF Due Diligence Reports.
 * 3. Conversion of plain text contracts to formatted PDF contracts.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ============================================================================
// PART 1: ROBUST PDF TEXT EXTRACTOR
// ============================================================================

/**
 * Extracts plain text from a PDF Buffer.
 * Supports uncompressed streams, FlateDecode (zlib) streams, Tj, TJ, hex strings,
 * octal escapes, and text-positioning operators.
 */
function extractTextFromPDF(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = fs.readFileSync(buffer);
  }

  let textResult = '';
  let pos = 0;

  while (pos < buffer.length) {
    const streamStart = buffer.indexOf(Buffer.from('stream'), pos);
    if (streamStart === -1) break;

    let contentStart = streamStart + 6;
    if (buffer[contentStart] === 0x0d && buffer[contentStart + 1] === 0x0a) {
      contentStart += 2;
    } else if (buffer[contentStart] === 0x0a || buffer[contentStart] === 0x0d) {
      contentStart += 1;
    }

    const streamEnd = buffer.indexOf(Buffer.from('endstream'), contentStart);
    if (streamEnd === -1) break;

    pos = streamEnd + 9;

    const streamBytes = buffer.subarray(contentStart, streamEnd);
    let streamStr = '';

    try {
      const decompressed = zlib.inflateSync(streamBytes);
      streamStr = decompressed.toString('latin1');
    } catch (err) {
      streamStr = streamBytes.toString('latin1');
    }

    const btRegex = /BT([\s\S]*?)ET/g;
    let btMatch;

    while ((btMatch = btRegex.exec(streamStr)) !== null) {
      const block = btMatch[1];
      let blockText = '';
      
      const tjRegex = /(?:\((.*?)\)\s*(?:Tj|'|"))|(?:\[([\s\S]*?)\]\s*TJ)/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        if (tjMatch[1] !== undefined) {
          blockText += unescapePdfString(tjMatch[1]) + ' ';
        } else if (tjMatch[2] !== undefined) {
          const parts = tjMatch[2];
          const innerRegex = /(?:\((.*?)\))|(?:<([0-9a-fA-F]+)>)/g;
          let pMatch;
          while ((pMatch = innerRegex.exec(parts)) !== null) {
            if (pMatch[1] !== undefined) blockText += unescapePdfString(pMatch[1]);
            else if (pMatch[2] !== undefined) blockText += parseHexPdfString(pMatch[2]);
          }
          blockText += ' ';
        }
      }

      if (blockText.trim()) {
        textResult += blockText.trim() + '\n\n';
      }
    }
  }

  if (!textResult.trim()) {
    const rawMatch = buffer.toString('latin1').match(/\(([^)]{4,})\)\s*Tj/g);
    if (rawMatch) {
      textResult = rawMatch.map(m => {
        const c = m.match(/\((.*)\)\s*Tj/);
        return c ? unescapePdfString(c[1]) : '';
      }).join(' ');
    }
  }

  return cleanExtractedText(textResult);
}

function unescapePdfString(str) {
  return str
    .replace(/\\([0-7]{1,3})/g, (m, oct) => String.fromCharCode(parseInt(oct, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\b/g, '\b')
    .replace(/\\f/g, '\f')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function parseHexPdfString(hex) {
  let res = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substr(i, 2), 16);
    if (!isNaN(byte)) res += String.fromCharCode(byte);
  }
  return res;
}

function cleanExtractedText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// ============================================================================
// PART 2: HIGH-FIDELITY PDF BUILDER WITH EXACT FONT METRICS & TEXT WRAPPING
// ============================================================================

// Helvetica standard font width table (1000 units per em)
const HELVETICA_WIDTHS = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556,
  '8': 556, '9': 556, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556,
  '@': 1015, 'A': 667, 'B': 667, 'C': 722, 'D': 722, 'E': 667, 'F': 611, 'G': 778,
  'H': 722, 'I': 278, 'J': 500, 'K': 667, 'L': 556, 'M': 833, 'N': 722, 'O': 778,
  'P': 667, 'Q': 778, 'R': 722, 'S': 667, 'T': 611, 'U': 722, 'V': 667, 'W': 944,
  'X': 667, 'Y': 667, 'Z': 611, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556,
  '`': 333, 'a': 556, 'b': 556, 'c': 500, 'd': 556, 'e': 556, 'f': 278, 'g': 556,
  'h': 556, 'i': 222, 'j': 222, 'k': 500, 'l': 222, 'm': 833, 'n': 556, 'o': 556,
  'p': 556, 'q': 556, 'r': 333, 's': 500, 't': 278, 'u': 556, 'v': 500, 'w': 722,
  'x': 500, 'y': 500, 'z': 500, '{': 334, '|': 260, '}': 334, '~': 584
};

function sanitizeTextForPdf(str) {
  if (typeof str !== 'string') str = String(str || '');
  let safe = '';
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const ch = str[i];
    if (ch === '(' || ch === ')' || ch === '\\') {
      safe += '\\' + ch;
    } else if (code >= 32 && code <= 126) {
      safe += ch;
    } else if (code >= 160 && code <= 255) {
      safe += ch;
    } else if (ch === '—' || ch === '–') {
      safe += '-';
    } else if (ch === '“' || ch === '”') {
      safe += '"';
    } else if (ch === '‘' || ch === '’') {
      safe += "'";
    } else if (ch === '•') {
      safe += '*';
    } else {
      safe += ' ';
    }
  }
  return safe;
}

function measureString(str, font, size) {
  if (!str) return 0;
  let total = 0;
  const isBold = font === 'F2';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    const w = HELVETICA_WIDTHS[ch] || 540;
    total += w;
  }
  let pt = (total / 1000) * size;
  if (isBold) pt *= 1.05;
  return pt;
}

function wrapText(str, maxWidth, font, size) {
  if (!str) return [];
  const words = String(str || '').replace(/\r?\n/g, ' ').split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const w of words) {
    if (measureString(w, font, size) > maxWidth) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      let subWord = '';
      for (let i = 0; i < w.length; i++) {
        if (measureString(subWord + w[i] + '-', font, size) > maxWidth && subWord) {
          lines.push(subWord + '-');
          subWord = w[i];
        } else {
          subWord += w[i];
        }
      }
      if (subWord) currentLine = subWord;
      continue;
    }

    const test = currentLine ? currentLine + ' ' + w : w;
    if (measureString(test, font, size) > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = w;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

class PDFBuilder {
  constructor() {
    this.pages = [];
    this.currentPage = null;
    this.width = 612; // US Letter points (8.5 x 11 inches)
    this.height = 792;
    this.margin = 40;
    this.contentWidth = this.width - this.margin * 2; // 532 pt
    this.contentBottom = 48; // Safe margin above bottom footer
    this.contentTop = 744;    // Safe margin below top running header
    this.addPage();
  }

  addPage() {
    const isFirst = this.pages.length === 0;
    this.currentPage = {
      ops: [],
      y: isFirst ? (this.height - this.margin) : this.contentTop
    };
    this.pages.push(this.currentPage);
    return this.currentPage;
  }

  get y() {
    return this.currentPage.y;
  }

  set y(val) {
    this.currentPage.y = val;
  }

  checkPageBreak(neededHeight) {
    if (this.currentPage.y - neededHeight < this.contentBottom) {
      this.addPage();
      return true;
    }
    return false;
  }

  rect(x, y, w, h, fillRGB = null, strokeRGB = null, lineWidth = 1) {
    let s = '';
    if (lineWidth) s += lineWidth + ' w ';
    if (fillRGB) {
      s += (fillRGB[0]/255).toFixed(3) + ' ' + (fillRGB[1]/255).toFixed(3) + ' ' + (fillRGB[2]/255).toFixed(3) + ' rg ';
    }
    if (strokeRGB) {
      s += (strokeRGB[0]/255).toFixed(3) + ' ' + (strokeRGB[1]/255).toFixed(3) + ' ' + (strokeRGB[2]/255).toFixed(3) + ' RG ';
    }
    s += x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re ';
    if (fillRGB && strokeRGB) s += 'B ';
    else if (fillRGB) s += 'f ';
    else if (strokeRGB) s += 'S ';
    this.currentPage.ops.push(s);
  }

  line(x1, y1, x2, y2, strokeRGB = [210, 215, 225], lineWidth = 1) {
    const s = lineWidth + ' w ' +
      (strokeRGB[0]/255).toFixed(3) + ' ' + (strokeRGB[1]/255).toFixed(3) + ' ' + (strokeRGB[2]/255).toFixed(3) + ' RG ' +
      x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' +
      x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S ';
    this.currentPage.ops.push(s);
  }

  text(str, x, y, options = {}) {
    const size = options.size || 10;
    const font = options.font || 'F1'; // F1: Helvetica, F2: Bold, F3: Oblique
    const color = options.color || [30, 35, 45];
    const safe = sanitizeTextForPdf(str);

    const s = 'BT /' + font + ' ' + size + ' Tf ' +
      (color[0]/255).toFixed(3) + ' ' + (color[1]/255).toFixed(3) + ' ' + (color[2]/255).toFixed(3) + ' rg ' +
      x.toFixed(2) + ' ' + y.toFixed(2) + ' Td (' + safe + ') Tj ET';
    this.currentPage.ops.push(s);
  }

  drawBadge(label, x, y, type = 'CRITICAL') {
    let bg = [220, 53, 69]; // Critical (crimson)
    let fg = [255, 255, 255];
    let w = 54;
    let textLabel = label;

    if (type === 'CRITICAL') {
      bg = [220, 53, 69];
      w = 54;
      textLabel = 'CRITICAL';
    } else if (type === 'HIGH') {
      bg = [225, 115, 20]; // Orange
      w = 46;
      textLabel = 'HIGH';
    } else if (type === 'MEDIUM') {
      bg = [241, 196, 15]; // Yellow
      fg = [50, 40, 10];
      w = 52;
      textLabel = 'MEDIUM';
    } else if (type === 'LOW' || type === 'CLEAN') {
      bg = [35, 155, 65]; // Green
      w = 42;
      textLabel = 'LOW';
    } else if (type === 'CP_YES') {
      bg = [190, 45, 45];
      textLabel = 'CP: YES';
      w = 58;
    } else if (type === 'CP_NO') {
      bg = [100, 110, 125];
      textLabel = 'CP: NO';
      w = 54;
    }

    const h = 13;
    this.rect(x, y - 2, w, h, bg, null);
    const tw = measureString(textLabel, 'F2', 7);
    const tx = x + Math.max(2, (w - tw) / 2);
    this.text(textLabel, tx, y + 1.5, { font: 'F2', size: 7, color: fg });
    return w;
  }

  drawWrappedParagraph(str, x, width, options = {}) {
    if (!str) return;
    const size = options.size || 9;
    const font = options.font || 'F1';
    const lineHeight = options.lineHeight || size * 1.35;
    const color = options.color || [40, 45, 55];
    const lines = wrapText(str, width, font, size);
    if (!lines.length) return;

    if (options.keepTogether) {
      this.checkPageBreak(lines.length * lineHeight + 4);
    }

    for (const line of lines) {
      if (this.currentPage.y - lineHeight < this.contentBottom) {
        this.addPage();
      }
      this.text(line, x, this.currentPage.y, { size, font, color });
      this.currentPage.y -= lineHeight;
    }
  }

  buildBuffer() {
    let out = '';
    const offsets = [];

    function addObj(str) {
      offsets.push(Buffer.byteLength(out, 'latin1'));
      out += str + '\n';
    }

    out += '%PDF-1.4\n';

    // 1: Catalog
    addObj('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj');

    // 2: Pages container
    const kidsStr = this.pages.map((_, i) => (7 + i * 2) + ' 0 R').join(' ');
    addObj('2 0 obj << /Type /Pages /Kids [' + kidsStr + '] /Count ' + this.pages.length + ' >> endobj');
    addObj('3 0 obj << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >> >> endobj');
    addObj('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj');
    addObj('5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj');
    addObj('6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >> endobj');

    // Pages & Contents
    const totalPages = this.pages.length;
    this.pages.forEach((page, idx) => {
      const pageObjNum = 7 + idx * 2;
      const contentObjNum = pageObjNum + 1;

      // Header on pages > 1
      if (idx > 0) {
        page.ops.push('0.5 w 0.82 0.85 0.90 RG 40 ' + (this.height - 28) + ' m 572 ' + (this.height - 28) + ' l S ');
        page.ops.push('BT /F2 8 Tf 0.30 0.35 0.45 rg 40 ' + (this.height - 24) + ' Td (M&A LEGAL DUE DILIGENCE REPORT  |  CONFIDENTIAL) Tj ET');
      }

      // Footer on all pages
      const footerY = 22;
      page.ops.push('0.5 w 0.82 0.85 0.90 RG 40 ' + (footerY + 12) + ' m 572 ' + (footerY + 12) + ' l S ');
      page.ops.push('BT /F1 7.5 Tf 0.45 0.48 0.52 rg 40 ' + footerY + ' Td (CONFIDENTIAL // ATTORNEY-CLIENT PRIVILEGED & WORK PRODUCT) Tj ET');
      page.ops.push('BT /F1 7.5 Tf 0.45 0.48 0.52 rg 520 ' + footerY + ' Td (Page ' + (idx + 1) + ' of ' + totalPages + ') Tj ET');

      const contentStr = page.ops.join('\n');
      const contentBuf = zlib.deflateSync(Buffer.from(contentStr, 'latin1'));

      addObj(pageObjNum + ' 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + this.width + ' ' + this.height + '] /Resources 3 0 R /Contents ' + contentObjNum + ' 0 R >> endobj');
      addObj(contentObjNum + ' 0 obj << /Length ' + contentBuf.length + ' /Filter /FlateDecode >>\nstream\n' + contentBuf.toString('latin1') + '\nendstream\nendobj');
    });

    const xrefOffset = Buffer.byteLength(out, 'latin1');
    const totalObjs = 7 + this.pages.length * 2;
    out += 'xref\n0 ' + totalObjs + '\n0000000000 65535 f \n';
    for (let i = 0; i < offsets.length; i++) {
      out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    }
    out += 'trailer << /Size ' + totalObjs + ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';

    return Buffer.from(out, 'latin1');
  }
}

// ============================================================================
// PART 3: FORMATTED DUE DILIGENCE PDF REPORT
// ============================================================================

function generateDueDiligencePDFReport(dealName, targetCompany, results, outputPath) {
  const doc = new PDFBuilder();

  // Metrics calculation
  const totalContracts = results.length;
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  results.forEach(r => {
    r.findings.forEach(f => {
      if (f.severity === 'CRITICAL') criticalCount++;
      else if (f.severity === 'HIGH') highCount++;
      else if (f.severity === 'MEDIUM') mediumCount++;
      else lowCount++;
    });
  });

  // 1. EXECUTIVE HEADER BANNER (Page 1)
  doc.rect(40, doc.y - 48, 532, 48, [15, 34, 64]);
  doc.text('M&A LEGAL DUE DILIGENCE REPORT', 52, doc.y - 20, { font: 'F2', size: 14.5, color: [255, 255, 255] });
  doc.text('Target: ' + targetCompany + '  |  Transaction: ' + dealName, 52, doc.y - 36, { font: 'F1', size: 9, color: [215, 230, 245] });
  doc.y -= 56;

  // 2. METADATA ROW
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  doc.text('CLASSIFICATION: CONFIDENTIAL // ATTORNEY-CLIENT PRIVILEGED', 40, doc.y, { font: 'F2', size: 7.5, color: [160, 40, 40] });
  doc.text('DATE: ' + dateStr + '  |  MATERIAL CONTRACTS AUDIT', 330, doc.y, { font: 'F1', size: 7.5, color: [100, 110, 125] });
  doc.y -= 16;

  // 3. EXECUTIVE RISK HEATMAP & SUMMARY SECTION
  doc.rect(40, doc.y - 18, 532, 18, [238, 242, 248]);
  doc.text('1. EXECUTIVE RISK HEATMAP & SUMMARY', 46, doc.y - 13, { font: 'F2', size: 9, color: [15, 34, 64] });
  doc.y -= 26;

  // Heatmap Metric Cards
  const boxW = 100;
  const boxH = 34;
  const startX = 40;
  const gap = (532 - (boxW * 5)) / 4; // 8 pt gap

  const summaryBoxes = [
    { title: 'CONTRACTS', val: String(totalContracts), bg: [240, 244, 250], fg: [20, 35, 60] },
    { title: 'CRITICAL', val: String(criticalCount), bg: [253, 237, 237], fg: [192, 40, 40] },
    { title: 'HIGH RISK', val: String(highCount), bg: [254, 243, 230], fg: [210, 110, 20] },
    { title: 'MEDIUM RISK', val: String(mediumCount), bg: [254, 249, 231], fg: [170, 130, 20] },
    { title: 'CLEAN / LOW', val: String(lowCount), bg: [235, 247, 238], fg: [35, 140, 60] }
  ];

  summaryBoxes.forEach((b, i) => {
    const bx = startX + i * (boxW + gap);
    doc.rect(bx, doc.y - boxH, boxW, boxH, b.bg, [215, 220, 230]);
    doc.text(b.title, bx + 10, doc.y - 12, { font: 'F2', size: 7.5, color: b.fg });
    doc.text(b.val, bx + 10, doc.y - 27, { font: 'F2', size: 13, color: b.fg });
  });

  doc.y -= (boxH + 16);

  // 4. MANDATORY PRE-CLOSING CONDITIONS PRECEDENT (CP) CHECKLIST
  doc.rect(40, doc.y - 18, 532, 18, [238, 242, 248]);
  doc.text('2. MANDATORY PRE-CLOSING CONDITIONS PRECEDENT (CP) CHECKLIST', 46, doc.y - 13, { font: 'F2', size: 9, color: [15, 34, 64] });
  doc.y -= 24;

  doc.text('The following third-party consents and waivers must be obtained prior to closing to prevent contract breach or transaction blockers:', 40, doc.y, { font: 'F3', size: 7.2, color: [80, 90, 105] });
  doc.y -= 12;

  function drawCPTableHeader() {
    doc.rect(40, doc.y - 16, 532, 16, [225, 232, 242]);
    doc.text('ID', 44, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.text('CONTRACT & PARTIES', 76, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.text('REQUIRED PRE-CLOSING ACTION', 205, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.text('RISK IF UNOBTAINED', 385, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.y -= 16;
  }

  drawCPTableHeader();

  let cpNum = 1;
  results.forEach(r => {
    if (r.closingCPRequired) {
      r.findings.filter(f => f.consentRequired || f.severity === 'CRITICAL').forEach(f => {
        const act = f.action || f.prescribedAction || '';
        
        // Wrap all cell contents with exact widths so text never collides
        const linesTitle = wrapText(r.contractTitle, 118, 'F2', 7.2);
        const linesParties = wrapText(r.parties.join(' / '), 118, 'F3', 6.5);
        const col2Height = (linesTitle.length * 8.5) + (linesParties.length * 7.5) + 3;

        const linesAction = wrapText(act, 165, 'F1', 6.8);
        const col3Height = linesAction.length * 8.2;

        const linesRisk = wrapText(f.analysis, 175, 'F1', 6.8);
        const col4Height = linesRisk.length * 8.2;

        const rowHeight = Math.max(26, col2Height, col3Height, col4Height) + 8;

        if (doc.checkPageBreak(rowHeight + 4)) {
          drawCPTableHeader();
        }

        const rowBg = cpNum % 2 === 0 ? [250, 252, 255] : [255, 255, 255];
        doc.rect(40, doc.y - rowHeight, 532, rowHeight, rowBg, [225, 230, 240]);

        // Cell 1: ID
        doc.text('CP-' + cpNum, 44, doc.y - 11, { font: 'F2', size: 7.5, color: [192, 40, 40] });

        // Cell 2: Title & Parties
        let y2 = doc.y - 9;
        linesTitle.forEach(l => { doc.text(l, 76, y2, { font: 'F2', size: 7.2, color: [20, 30, 45] }); y2 -= 8.5; });
        y2 -= 2;
        linesParties.forEach(l => { doc.text(l, 76, y2, { font: 'F3', size: 6.5, color: [90, 100, 115] }); y2 -= 7.5; });

        // Cell 3: Action
        let y3 = doc.y - 9;
        linesAction.forEach(l => { doc.text(l, 205, y3, { font: 'F1', size: 6.8, color: [30, 35, 45] }); y3 -= 8.2; });

        // Cell 4: Risk
        let y4 = doc.y - 9;
        linesRisk.forEach(l => { doc.text(l, 385, y4, { font: 'F1', size: 6.8, color: [140, 30, 30] }); y4 -= 8.2; });

        doc.y -= rowHeight;
        cpNum++;
      });
    }
  });

  doc.y -= 12;

  // 5. MASTER RED FLAG DUE DILIGENCE MATRIX
  doc.checkPageBreak(50);
  doc.rect(40, doc.y - 18, 532, 18, [238, 242, 248]);
  doc.text('3. MASTER RED FLAG DUE DILIGENCE MATRIX', 46, doc.y - 13, { font: 'F2', size: 9, color: [15, 34, 64] });
  doc.y -= 26;

  function drawMatrixTableHeader() {
    doc.rect(40, doc.y - 16, 532, 16, [225, 232, 242]);
    doc.text('CONTRACT', 45, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.text('CATEGORY', 165, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.text('SEVERITY', 265, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.text('CONSENT', 330, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.text('DEAL IMPLICATION / ANALYSIS', 396, doc.y - 11, { font: 'F2', size: 7.5, color: [30, 45, 65] });
    doc.y -= 16;
  }

  drawMatrixTableHeader();

  let rowIdx = 0;
  results.forEach(r => {
    r.findings.forEach(f => {
      const linesContract = wrapText(r.contractTitle, 105, 'F2', 7.2);
      const linesCategory = wrapText(f.category, 90, 'F1', 7.2);
      const consentStr = f.consentRequired ? 'Required (' + f.consentStandard + ')' : 'Not Required';
      const linesConsent = wrapText(consentStr, 55, 'F1', 6.6);
      const linesAnalysis = wrapText(f.analysis, 165, 'F1', 6.8);

      const rowHeight = Math.max(24, linesContract.length * 8.5, linesCategory.length * 8.5, linesConsent.length * 8.2, linesAnalysis.length * 8.2) + 8;

      if (doc.checkPageBreak(rowHeight + 4)) {
        drawMatrixTableHeader();
      }

      const rowBg = rowIdx % 2 === 0 ? [252, 253, 255] : [255, 255, 255];
      doc.rect(40, doc.y - rowHeight, 532, rowHeight, rowBg, [225, 230, 240]);

      // Cell 1: Contract
      let y1 = doc.y - 9;
      linesContract.forEach(l => { doc.text(l, 45, y1, { font: 'F2', size: 7.2, color: [20, 30, 45] }); y1 -= 8.5; });

      // Cell 2: Category
      let y2 = doc.y - 9;
      linesCategory.forEach(l => { doc.text(l, 165, y2, { font: 'F1', size: 7.2, color: [40, 50, 65] }); y2 -= 8.5; });

      // Cell 3: Severity Badge
      doc.drawBadge(f.severity, 265, doc.y - 10, f.severity);

      // Cell 4: Consent
      let y4 = doc.y - 9;
      linesConsent.forEach((l, idx) => {
        const isReq = f.consentRequired;
        doc.text(l, 330, y4, { font: idx === 0 && isReq ? 'F2' : 'F1', size: 6.6, color: isReq ? [170, 35, 35] : [35, 120, 50] });
        y4 -= 8.2;
      });

      // Cell 5: Deal Implication
      let y5 = doc.y - 9;
      linesAnalysis.forEach(l => { doc.text(l, 396, y5, { font: 'F1', size: 6.8, color: [30, 40, 50] }); y5 -= 8.2; });

      doc.y -= rowHeight;
      rowIdx++;
    });
  });

  doc.y -= 14;

  // 6. DETAILED CONTRACT-BY-CONTRACT AUDIT & VERBATIM CITATIONS
  doc.checkPageBreak(70);
  doc.rect(40, doc.y - 18, 532, 18, [238, 242, 248]);
  doc.text('4. DETAILED CONTRACT-BY-CONTRACT AUDIT & VERBATIM CITATIONS', 46, doc.y - 13, { font: 'F2', size: 9, color: [15, 34, 64] });
  doc.y -= 26;

  results.forEach((r, idx) => {
    // Keep contract header together with at least part of its content
    doc.checkPageBreak(75);

    // Contract Title Box
    doc.rect(40, doc.y - 20, 532, 20, [242, 246, 252], [200, 212, 230]);
    let cleanTitle = (idx + 1) + '. ' + r.contractTitle;
    if (measureString(cleanTitle, 'F2', 8.5) > 390) {
      while (measureString(cleanTitle + '...', 'F2', 8.5) > 390 && cleanTitle.length > 20) {
        cleanTitle = cleanTitle.substring(0, cleanTitle.length - 1);
      }
      cleanTitle += '...';
    }
    doc.text(cleanTitle, 46, doc.y - 13, { font: 'F2', size: 8.5, color: [15, 34, 64] });

    // Badges: Risk at 448 (w=54), CP at 508 (w=58). Clean 6pt gap, fits within 572 margin.
    doc.drawBadge(r.overallRisk, 448, doc.y - 13, r.overallRisk);
    doc.drawBadge(r.closingCPRequired ? 'CP_YES' : 'CP_NO', 508, doc.y - 13, r.closingCPRequired ? 'CP_YES' : 'CP_NO');
    doc.y -= 25;

    // Metadata Row
    const metaStr = 'Parties: ' + r.parties.join(', ') + '  |  Governing Law: ' + r.governingLaw + '  |  Effective: ' + r.effectiveDate;
    doc.text(metaStr, 45, doc.y, { font: 'F3', size: 7.2, color: [90, 100, 115] });
    doc.y -= 14;

    r.findings.forEach(f => {
      // Calculate finding component heights
      const rawQuote = f.quote.replace(/\s+/g, ' ').trim();
      const quoteText = rawQuote.length > 550 ? rawQuote.substring(0, 547) + '...' : rawQuote;
      const quoteLines = wrapText('"' + quoteText + '"', 495, 'F3', 6.8);
      const quoteTextHeight = quoteLines.length * 8.6;
      const boxHeight = 14 + quoteTextHeight + 6; // 14pt header space + lines + 6pt bottom pad

      const analysisLines = wrapText(f.analysis, 515, 'F1', 7.3);
      const analysisHeight = 12 + (analysisLines.length * 9.2);

      const act = f.action || f.prescribedAction || '';
      const actLines = wrapText(act, 515, 'F1', 7.3);
      const actHeight = 12 + (actLines.length * 9.2);

      const totalFindingHeight = 14 + boxHeight + 8 + analysisHeight + 4 + actHeight + 8;

      // Keep the whole finding block together if it doesn't fit and page already has content
      if (doc.y - totalFindingHeight < doc.contentBottom && doc.y < doc.contentTop - 110) {
        doc.addPage();
      }

      // Category Subtitle
      const catTitle = '[' + f.category + '] Severity: ' + f.severity + ' (Standard: ' + f.consentStandard + ')';
      doc.text(catTitle, 45, doc.y, { font: 'F2', size: 8, color: [20, 40, 75] });
      doc.y -= 12;

      // Background rectangle and left border accent
      doc.rect(45, doc.y - boxHeight, 522, boxHeight, [248, 249, 253], [215, 222, 235]);
      doc.rect(45, doc.y - boxHeight, 4, boxHeight, [20, 60, 120]);

      // Box Title (cleanly above the quote lines)
      doc.text('Verbatim Clause Citation:', 56, doc.y - 10, { font: 'F2', size: 7, color: [60, 75, 95] });

      // Quote Text (starts at y - 20, zero overlap with title)
      let qY = doc.y - 20;
      quoteLines.forEach(l => {
        doc.text(l, 56, qY, { font: 'F3', size: 6.8, color: [50, 55, 65] });
        qY -= 8.6;
      });
      doc.y -= (boxHeight + 8);

      // Legal Risk Assessment
      doc.checkPageBreak(analysisHeight + 4);
      doc.text('Legal Risk Assessment:', 45, doc.y - 2, { font: 'F2', size: 7.5, color: [150, 40, 40] });
      let aY = doc.y - 13;
      analysisLines.forEach(l => {
        doc.text(l, 45, aY, { font: 'F1', size: 7.3, color: [40, 45, 55] });
        aY -= 9.2;
      });
      doc.y -= (analysisHeight + 4);

      // Prescribed Transactional Action
      doc.checkPageBreak(actHeight + 4);
      doc.text('Prescribed Transactional Action:', 45, doc.y - 2, { font: 'F2', size: 7.5, color: [25, 120, 50] });
      let acY = doc.y - 13;
      actLines.forEach(l => {
        doc.text(l, 45, acY, { font: 'F1', size: 7.3, color: [40, 45, 55] });
        acY -= 9.2;
      });
      doc.y -= (actHeight + 8);
    });

    doc.line(40, doc.y, 572, doc.y, [225, 230, 240]);
    doc.y -= 14;
  });

  const pdfBuf = doc.buildBuffer();
  fs.writeFileSync(outputPath, pdfBuf);
  return pdfBuf;
}

// ============================================================================
// PART 4: CONVERT PLAIN TEXT CONTRACT TO FORMATTED PDF
// ============================================================================

function createContractPDF(title, rawText, outputPath) {
  const doc = new PDFBuilder();

  // Document Title Header
  doc.rect(40, doc.y - 35, 532, 35, [30, 45, 70]);
  const shortTitle = title.length > 55 ? title.substring(0, 52) + '...' : title;
  doc.text(shortTitle, 52, doc.y - 18, { font: 'F2', size: 12, color: [255, 255, 255] });
  doc.text('CONFIDENTIAL COMMERCIAL AGREEMENT', 52, doc.y - 29, { font: 'F1', size: 7.5, color: [200, 215, 235] });

  doc.y -= 45;

  const paragraphs = rawText.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean);

  for (const p of paragraphs) {
    if (/^(?:SECTION|ARTICLE|RECITALS|IN WITNESS)/i.test(p) && p.length < 80) {
      doc.checkPageBreak(24);
      doc.rect(40, doc.y - 14, 532, 14, [240, 244, 250]);
      doc.text(p, 45, doc.y - 10, { font: 'F2', size: 8.5, color: [20, 35, 60] });
      doc.y -= 20;
    } else {
      doc.drawWrappedParagraph(p, 40, 532, { size: 8.5, font: 'F1', color: [40, 45, 55], lineHeight: 12 });
      doc.y -= 8;
    }
  }

  const pdfBuf = doc.buildBuffer();
  fs.writeFileSync(outputPath, pdfBuf);
  return pdfBuf;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max - 3) + '...' : str;
}

module.exports = {
  extractTextFromPDF,
  generateDueDiligencePDFReport,
  createContractPDF,
  PDFBuilder
};
