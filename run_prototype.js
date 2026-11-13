/**
 * Standalone zero-dependency executable for Legal M&A Due Diligence Automation.
 * Can be run immediately with: agy-node run_prototype.js
 */

const fs = require('fs');
const path = require('path');
const { extractTextFromPDF, generateDueDiligencePDFReport } = require('./pdf_engine.js');

const CONTRACTS_DIR = path.join(__dirname, 'contracts');
const REPORTS_DIR = path.join(__dirname, 'reports');

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function extractMetadata(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const title = lines[0] || 'Commercial Agreement';

  const dateMatch = text.match(/as of ([A-Z][a-z]+ \d{1,2}, \d{4})/i) || text.match(/dated as of ([A-Z][a-z]+ \d{1,2}, \d{4})/i);
  const effectiveDate = dateMatch ? dateMatch[1] : 'Unknown';

  let governingLaw = 'Unspecified';
  const lawMatch = text.match(/governed by(?: and (?:construed in accordance with|interpreted))? (?:under )?the laws of (?:the State of )?([A-Za-z\s]+?)(?:,|\.|\s+without)/i)
    || text.match(/governed by ([A-Za-z]+) law without/i);
  if (lawMatch) {
    governingLaw = lawMatch[1].trim();
  }

  const partyMatch = text.match(/by and between (.+?) and (.+?)(?:\.|\n|\()/s);
  let parties = ['Target Technologies Corp.', 'Counterparty'];
  if (partyMatch) {
    parties = [
      partyMatch[1].split(',')[0].replace(/\s+/g, ' ').trim(),
      partyMatch[2].split(',')[0].replace(/\s+/g, ' ').trim()
    ];
  }

  return { title, effectiveDate, governingLaw, parties };
}

function analyzeContract(fileName, text) {
  const meta = extractMetadata(text);
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 40);

  const findings = [];

  for (const p of paragraphs) {
    const lower = p.toLowerCase();

    // 1. Change of Control
    if (lower.includes('change of control') || lower.includes('change in control') || lower.includes('change in ownership')) {
      let severity = 'MEDIUM';
      let consentStd = 'Silent / Unspecified';
      let consentReq = lower.includes('consent') || lower.includes('approval');
      const termRisk = lower.includes('terminate this agreement') || lower.includes('right to immediately terminate') || lower.includes('material breach');
      const noticeMatch = p.match(/(\d+)\s*days?\s*prior/i);
      const noticeDays = noticeMatch ? parseInt(noticeMatch[1], 10) : null;

      if (lower.includes('sole and absolute discretion') || lower.includes('sole discretion')) {
        consentStd = 'Sole and Absolute Discretion';
      } else if (lower.includes('not to be unreasonably withheld')) {
        consentStd = 'Not Unreasonably Withheld/Delayed';
      }

      const hasCarveout = lower.includes('permitted m&a carve-out') || lower.includes('in connection with a merger') || lower.includes('without the consent of the other party');

      let analysis = '';
      let action = '';

      if (hasCarveout && !consentReq) {
        severity = 'LOW';
        consentReq = false;
        consentStd = 'Consent Not Required';
        analysis = 'Contains express M&A carve-out permitting transfer via merger or sale of assets/stock. Notice required post-closing; no pre-closing consent blocker.';
        action = 'Post-closing notice compliance (ensure notice delivered within prescribed timeline). No CP needed.';
      } else if (consentStd === 'Sole and Absolute Discretion' || (termRisk && consentReq)) {
        severity = 'CRITICAL';
        analysis = 'CRITICAL CLOSING BLOCKER: Transaction explicitly triggers Change of Control consent. Counterparty holds sole discretion to withhold consent and retains unilateral termination rights or clawback remedies upon closing without prior consent.';
        action = 'MANDATORY: (1) Include as a closing Condition Precedent (CP) to obtain written counterparty consent; (2) List on Seller Disclosure Schedule 3.4 (Consents & Approvals); (3) Formulate pre-signing outreach strategy.';
      } else if (consentReq) {
        severity = 'HIGH';
        analysis = 'Change of Control requires counterparty consent. While not explicitly subject to sole discretion, failure to obtain consent creates risk of contract repudiation or post-closing renegotiation.';
        action = 'Obtain formal waiver/consent prior to Closing or secure closing condition in Acquisition Agreement.';
      } else {
        severity = 'MEDIUM';
        analysis = 'Change of control provisions present; terms require review for indirect ownership transfer thresholds.';
        action = 'Include on M&A Disclosure Schedule.';
      }

      findings.push({
        category: 'Change of Control (CoC)',
        severity,
        consentRequired: consentReq,
        consentStandard: consentStd,
        noticeDays,
        terminationRisk: termRisk,
        affiliateRisk: false,
        quote: p,
        analysis,
        action
      });
    }

    // 2. Assignment
    else if (lower.includes('assign') || lower.includes('transfer this agreement') || lower.includes('by operation of law')) {
      if (lower.includes('permitted') && (lower.includes('merger') || lower.includes('substantially all'))) {
        findings.push({
          category: 'Assignment & Transfer',
          severity: 'LOW',
          consentRequired: false,
          consentStandard: 'Consent Not Required',
          noticeDays: 15,
          terminationRisk: false,
          affiliateRisk: false,
          quote: p,
          analysis: 'Standard M&A successor carve-out. Allows assignment without consent in connection with a merger or asset/stock acquisition. Check competitor exclusions (Exhibit D).',
          action: 'Confirm Buyer is not a listed competitor on Exhibit D; diarize post-closing notice within 15 business days.'
        });
      } else {
        const consentReq = lower.includes('prior written consent') || lower.includes("without the other party's");
        let consentStd = 'Silent / Unspecified';
        let severity = 'HIGH';
        let analysis = 'Strict anti-assignment restriction without reasonableness qualification. Potential blocker if transaction involves asset transfer or forward statutory merger.';
        let action = 'Obtain assignment consent prior to closing if structure involves transfer of contracts.';

        if (lower.includes('not to be unreasonably withheld')) {
          consentStd = 'Not Unreasonably Withheld/Delayed';
          severity = 'MEDIUM';
          analysis = "General anti-assignment clause with reasonableness standard. Restricts assignment by 'operation of law'. If deal is structured as a Reverse Triangular Merger or stock sale, may not constitute an assignment (under Delaware law / Meso Scale doctrine), but Asset Sale or Forward Merger would trigger consent requirement.";
          action = 'Review deal structure (Stock vs. Asset). If Asset Sale or Forward Merger, consent required. List on Disclosure Schedule 3.4.';
        }

        findings.push({
          category: 'Assignment & Transfer',
          severity,
          consentRequired: consentReq,
          consentStandard: consentStd,
          noticeDays: null,
          terminationRisk: false,
          affiliateRisk: false,
          quote: p,
          analysis,
          action
        });
      }
    }

    // 3. Restrictive Covenants / Non-Competes (operative sections only, skipping title/recitals)
    const isOperative = lower.includes('shall not') || lower.includes('negative covenant') || lower.includes('exclusive appointment') || lower.includes('non-compete');
    const isRestrictive = isOperative && (lower.includes('non-compete') || lower.includes('competing') || lower.includes('exclusive'));
    if (isRestrictive && !lower.includes('change of control') && !lower.includes('assignment and transfers') && !lower.includes('recitals')) {
      const affiliateRisk = lower.includes('affiliate') || lower.includes('current or future affiliate') || lower.includes('parent entities');
      const severity = affiliateRisk ? 'CRITICAL' : 'HIGH';
      const analysis = affiliateRisk
        ? "HIGH-SEVERITY CONTAMINATION RISK: Restrictive covenant / non-compete explicitly binds Target's 'current or future Affiliates and parent entities'. Following closing, Buyer and its existing subsidiaries would become 'Affiliates' and could be legally prohibited from distributing competing products in the Territory!"
        : "Exclusivity or territorial restriction limits Target's commercial freedom in North America.";
      const action = affiliateRisk
        ? 'DEAL STRUCTURING PRIORITY: (1) Mandatory closing waiver or contract amendment carving out Buyer and Buyer\'s pre-existing affiliates; (2) Alternatively, isolate Target in a remote corporate subsidiary ring-fence.'
        : 'Disclose on Schedule 3.16 (Material Contracts & Restrictive Covenants).';

      findings.push({
        category: 'Restrictive Covenant / Non-Compete',
        severity,
        consentRequired: false,
        consentStandard: 'Consent Not Required',
        noticeDays: null,
        terminationRisk: false,
        affiliateRisk,
        quote: p,
        analysis,
        action
      });
    }

    // 4. Termination for Convenience
    if (lower.includes('termination for convenience') || lower.includes('terminate this agreement without cause') || lower.includes('sole convenience')) {
      findings.push({
        category: 'Termination for Convenience',
        severity: 'HIGH',
        consentRequired: false,
        consentStandard: 'Consent Not Required',
        noticeDays: 30,
        terminationRisk: true,
        affiliateRisk: false,
        quote: p,
        analysis: 'Unilateral termination for convenience by counterparty on short notice (30 days). Presents revenue vulnerability post-acquisition: counterparty can walk away immediately upon learning of the deal.',
        action: 'Financial DD coordination: Assess customer concentration and valuation haircut if counterparty terminates; consider retention conversations as part of pre-closing integration.'
      });
    }
  }

  // Determine overall contract risk
  let overallRisk = 'INFO';
  const sevs = findings.map(f => f.severity);
  if (sevs.includes('CRITICAL')) overallRisk = 'CRITICAL';
  else if (sevs.includes('HIGH')) overallRisk = 'HIGH';
  else if (sevs.includes('MEDIUM')) overallRisk = 'MEDIUM';
  else if (sevs.includes('LOW')) overallRisk = 'LOW';

  const cpRequired = findings.some(f => (f.severity === 'CRITICAL' || f.severity === 'HIGH') && (f.consentRequired || f.affiliateRisk));

  return {
    fileName,
    contractTitle: meta.title,
    parties: meta.parties,
    effectiveDate: meta.effectiveDate,
    governingLaw: meta.governingLaw,
    findings,
    overallRisk,
    closingCPRequired: cpRequired,
    disclosureRequired: findings.length > 0
  };
}

function generateMarkdownReport(dealName, targetName, results, outputPath) {
  let criticalCount = results.filter(r => r.overallRisk === 'CRITICAL').length;
  let highCount = results.filter(r => r.overallRisk === 'HIGH').length;
  let medCount = results.filter(r => r.overallRisk === 'MEDIUM').length;
  let lowCount = results.filter(r => r.overallRisk === 'LOW').length;

  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  let md = `# M&A Legal Due Diligence: Red Flag & Transaction Matrix\n`;
  md += `**Target Company:** ${targetName}  \n`;
  md += `**Transaction:** ${dealName}  \n`;
  md += `**Date:** ${dateStr} | **Classification:** Confidential / Attorney-Client Privileged\n\n`;
  md += `---\n\n`;

  md += `## 1. Executive Summary & Risk Heatmap\n\n`;
  md += `| Metric | Count | Deal Implication |\n`;
  md += `| :--- | :---: | :--- |\n`;
  md += `| **Total Material Contracts Analyzed** | **${results.length}** | Complete sample audit |\n`;
  md += `| 🔴 **Critical Risks** | **${criticalCount}** | **Mandatory Conditions Precedent (CP)** or Buyer contamination risk |\n`;
  md += `| 🟠 **High Risks** | **${highCount}** | Prior consent required / revenue walk-away exposure |\n`;
  md += `| 🟡 **Medium Risks** | **${medCount}** | Reasonableness qualified / deal structure dependent |\n`;
  md += `| 🟢 **Low / Clean** | **${lowCount}** | Standard M&A carve-out or post-closing notice only |\n\n`;

  md += `## 2. Mandatory Closing Conditions Precedent (CP) Checklist\n\n`;
  md += `The following third-party consents and waivers must be obtained **prior to closing** to prevent catastrophic breach, contract termination, or Buyer business contamination:\n\n`;
  md += `| # | Contract / Counterparty | Required Pre-Closing Action | Risk if Unobtained |\n`;
  md += `| :-: | :--- | :--- | :--- |\n`;

  let cpIndex = 1;
  results.forEach(r => {
    if (r.closingCPRequired) {
      r.findings.forEach(f => {
        if ((f.severity === 'CRITICAL' || f.severity === 'HIGH') && f.consentRequired) {
          md += `| CP-${cpIndex++} | **${r.contractTitle}**<br>_${r.parties.join(', ')}_ | ${f.action} | ${f.analysis.split('.')[0]}. |\n`;
        } else if (f.affiliateRisk) {
          md += `| CP-${cpIndex++} | **${r.contractTitle}**<br>_${r.parties.join(', ')}_ | ${f.action} | Buyer and all Buyer Affiliates bound by territorial non-compete post-closing! |\n`;
        }
      });
    }
  });

  md += `\n---\n\n`;

  md += `## 3. Master Red Flag Due Diligence Matrix\n\n`;
  md += `| Contract Title | Category | Severity | Consent Req? | Standard | Deal Impact & Required Action |\n`;
  md += `| :--- | :--- | :---: | :---: | :--- | :--- |\n`;

  results.forEach(r => {
    r.findings.forEach(f => {
      let icon = f.severity === 'CRITICAL' ? '🔴 **CRITICAL**' : f.severity === 'HIGH' ? '🟠 **HIGH**' : f.severity === 'MEDIUM' ? '🟡 **MEDIUM**' : '🟢 **LOW**';
      let consentBadge = f.consentRequired ? '⚠️ **YES**' : 'No';
      md += `| **${r.contractTitle}** | ${f.category} | ${icon} | ${consentBadge} | ${f.consentStandard} | **Analysis:** ${f.analysis}<br>**Action:** ${f.action} |\n`;
    });
  });

  md += `\n---\n\n`;

  md += `## 4. Contract-by-Contract Detailed Audit with Verbatim Citations\n\n`;
  results.forEach((r, idx) => {
    md += `### 4.${idx + 1} ${r.contractTitle}\n`;
    md += `- **File:** \`${r.fileName}\`\n`;
    md += `- **Parties:** ${r.parties.join(', ')}\n`;
    md += `- **Governing Law:** ${r.governingLaw} | **Effective Date:** ${r.effectiveDate}\n`;
    md += `- **Overall Risk Rating:** \`${r.overallRisk}\`\n`;
    md += `- **Closing Condition Precedent (CP) Required:** \`${r.closingCPRequired ? 'YES' : 'NO'}\`\n`;
    md += `- **Disclosure Schedule Entry Required:** \`${r.disclosureRequired ? 'YES (Schedule 3.4 / 3.16)' : 'NO'}\`\n\n`;

    md += `#### Verbatim Clause Extracts & Legal Annotations:\n`;
    r.findings.forEach(f => {
      md += `> **[${f.category} — ${f.severity}]**\n`;
      md += `> _"${f.quote.replace(/\n+/g, ' ')}"_\n\n`;
      md += `- **Legal Assessment:** ${f.analysis}\n`;
      md += `- **Prescribed Action:** ${f.action}\n\n`;
    });
    md += `\n`;
  });

  fs.writeFileSync(outputPath, md, 'utf-8');
}

function generateCSVMatrix(results, outputPath) {
  const headers = [
    'Contract File',
    'Contract Title',
    'Parties',
    'Governing Law',
    'Clause Category',
    'Risk Severity',
    'Consent Required',
    'Consent Standard',
    'Notice Period (Days)',
    'Closing Termination Risk',
    'Affiliate Contamination Risk',
    'Legal Analysis',
    'Recommended Action',
    'Condition Precedent',
    'Verbatim Clause Excerpt'
  ];

  const rows = [headers.map(h => `"${h}"`).join(',')];

  results.forEach(r => {
    r.findings.forEach(f => {
      const isCP = (f.severity === 'CRITICAL' || f.severity === 'HIGH') && (f.consentRequired || f.affiliateRisk);
      const row = [
        r.fileName,
        r.contractTitle,
        r.parties.join('; '),
        r.governingLaw,
        f.category,
        f.severity,
        f.consentRequired ? 'YES' : 'NO',
        f.consentStandard,
        f.noticeDays !== null ? f.noticeDays : 'N/A',
        f.terminationRisk ? 'YES' : 'NO',
        f.affiliateRisk ? 'YES' : 'NO',
        f.analysis,
        f.action,
        isCP ? 'YES' : 'NO',
        f.quote.replace(/\r?\n|\r/g, ' ').replace(/"/g, '""')
      ];
      rows.push(row.map(cell => `"${cell}"`).join(','));
    });
  });

  fs.writeFileSync(outputPath, rows.join('\n'), 'utf-8');
}

function generateHTMLDashboard(dealName, targetName, results, outputPath) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let criticalCount = results.filter(r => r.overallRisk === 'CRITICAL').length;
  let highCount = results.filter(r => r.overallRisk === 'HIGH').length;
  let medCount = results.filter(r => r.overallRisk === 'MEDIUM').length;
  let lowCount = results.filter(r => r.overallRisk === 'LOW').length;

  let totalFindings = 0;
  let criticalFindings = 0;
  let highFindings = 0;
  let medFindings = 0;
  let lowFindings = 0;
  results.forEach(r => {
    r.findings.forEach(f => {
      totalFindings++;
      if (f.severity === 'CRITICAL') criticalFindings++;
      else if (f.severity === 'HIGH') highFindings++;
      else if (f.severity === 'MEDIUM') medFindings++;
      else lowFindings++;
    });
  });

  const uniqueCategories = Array.from(new Set(results.flatMap(r => r.findings.map(f => f.category)))).sort();
  const uniqueContracts = Array.from(new Set(results.map(r => r.contractTitle))).sort();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>M&A Legal Due Diligence Matrix - ${dealName}</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚖️</text></svg>">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <style>
    :root {
      --bg: #0b1120;
      --card-bg: #1e293b;
      --card-bg-subtle: #162032;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --border: #334155;
      --border-subtle: #243248;
      --critical: #ef4444;
      --critical-bg: #450a0a;
      --critical-border: #991b1b;
      --high: #f97316;
      --high-bg: #431407;
      --high-border: #9a3412;
      --med: #eab308;
      --med-bg: #422006;
      --med-border: #854d0e;
      --low: #10b981;
      --low-bg: #052e16;
      --low-border: #166534;
      --accent: #38bdf8;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 30px;
      line-height: 1.5;
    }
    .header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
      margin-bottom: 28px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .badge-conf {
      background: #451a03;
      color: #fb923c;
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 700;
      letter-spacing: 0.05em;
      border: 1px solid #7c2d12;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
      cursor: pointer;
      transition: all 0.2s ease;
      user-select: none;
    }
    .metric-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .metric-val {
      font-size: 30px;
      font-weight: 800;
      margin-top: 6px;
    }
    .val-critical { color: var(--critical); }
    .val-high { color: var(--high); }
    .val-med { color: var(--med); }
    .val-low { color: var(--low); }
    .val-total { color: var(--accent); }

    /* Interactive Search & Filter Toolbar */
    .toolbar-container {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 28px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    }
    .toolbar-top {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 14px;
    }
    .search-wrapper {
      flex: 2 1 300px;
      position: relative;
    }
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      width: 100%;
      background: #0b1120;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px 10px 38px;
      color: var(--text);
      font-size: 13.5px;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .search-input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.2);
    }
    .search-input::placeholder {
      color: #64748b;
    }
    .filter-select {
      flex: 1 1 180px;
      background: #0b1120;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      color: var(--text);
      font-size: 13px;
      outline: none;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .filter-select:focus {
      border-color: var(--accent);
    }
    .toolbar-middle {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
    }
    .filter-label {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-right: 4px;
    }
    .filter-pill {
      background: #0b1120;
      border: 1px solid var(--border);
      color: var(--text-muted);
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      user-select: none;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .filter-pill:hover {
      border-color: #64748b;
      color: var(--text);
    }
    .filter-pill.active {
      background: rgba(56, 189, 248, 0.15);
      border-color: var(--accent);
      color: var(--accent);
    }
    .filter-pill.active[data-risk="CRITICAL"] {
      background: rgba(239, 68, 68, 0.2);
      border-color: var(--critical);
      color: #fca5a5;
    }
    .filter-pill.active[data-risk="HIGH"] {
      background: rgba(249, 115, 22, 0.2);
      border-color: var(--high);
      color: #fdba74;
    }
    .filter-pill.active[data-risk="MEDIUM"] {
      background: rgba(234, 179, 8, 0.2);
      border-color: var(--med);
      color: #fef08a;
    }
    .filter-pill.active[data-risk="LOW"] {
      background: rgba(16, 185, 129, 0.2);
      border-color: var(--low);
      color: #86efac;
    }
    .toolbar-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 10px;
      border-top: 1px solid rgba(51, 65, 85, 0.6);
      font-size: 12.5px;
      color: var(--text-muted);
      flex-wrap: wrap;
      gap: 8px;
    }
    .btn-reset {
      background: transparent;
      border: none;
      color: var(--accent);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      text-decoration: underline;
      padding: 0;
    }
    .btn-reset:hover {
      color: #7dd3fc;
    }
    .btn-export {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #065f46;
      color: #ecfdf5;
      border: 1px solid #059669;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      user-select: none;
    }
    .btn-export:hover {
      background: #047857;
      border-color: #10b981;
      color: #ffffff;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35);
    }
    .btn-export svg {
      width: 16px;
      height: 16px;
    }
    .btn-export-toolbar {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #1e293b;
      color: #38bdf8;
      border: 1px solid #334155;
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      user-select: none;
    }
    .btn-export-toolbar:hover {
      background: #0f172a;
      border-color: #38bdf8;
      color: #7dd3fc;
    }
    
    .section-title {
      font-size: 19px;
      font-weight: 700;
      margin: 32px 0 14px 0;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .section-subtitle {
      font-size: 13px;
      color: var(--text-muted);
      margin: -8px 0 14px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--card-bg);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 36px;
      border: 1px solid var(--border);
    }
    th, td {
      padding: 13px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border);
      font-size: 13.5px;
      vertical-align: top;
    }
    th {
      background: #172033;
      color: var(--text-muted);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.05em;
    }
    tr:hover { background: #243248; }
    .tag {
      display: inline-block;
      padding: 3px 9px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .tag-critical { background: var(--critical-bg); color: #f87171; border: 1px solid var(--critical-border); }
    .tag-high { background: var(--high-bg); color: #fb923c; border: 1px solid var(--high-border); }
    .tag-med { background: var(--med-bg); color: #facc15; border: 1px solid var(--med-border); }
    .tag-low { background: var(--low-bg); color: #4ade80; border: 1px solid var(--low-border); }
    
    details {
      background: #0b1120;
      padding: 9px 12px;
      border-radius: 6px;
      margin-top: 8px;
      border: 1px solid var(--border);
    }
    summary {
      cursor: pointer;
      color: var(--accent);
      font-weight: 600;
      font-size: 12px;
      user-select: none;
    }
    .quote-box {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11.5px;
      color: #cbd5e1;
      margin-top: 8px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .empty-row td {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
      font-size: 14px;
      background: #131d2e;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1 style="margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.02em;">M&A Legal Due Diligence Matrix</h1>
      <p style="margin: 6px 0 0 0; color: var(--text-muted); font-size: 13.5px;">
        Deal: <strong style="color: var(--text);">${dealName}</strong> &bull; 
        Target: <strong style="color: var(--text);">${targetName}</strong> &bull; 
        Audit Date: <strong style="color: var(--text);">${dateStr}</strong>
      </p>
    </div>
    <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
      <button id="exportExcelBtn" class="btn-export" onclick="exportToExcel()">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span>Export to Excel (.xlsx)</span>
      </button>
      <div class="badge-conf">ATTORNEY-CLIENT PRIVILEGED</div>
    </div>
  </div>

  <div class="metrics">
    <div class="metric-card" onclick="filterByRisk('ALL')">
      <div style="color: var(--text-muted); font-size: 12.5px; font-weight: 600;">Contracts Audited</div>
      <div class="metric-val val-total">${results.length}</div>
    </div>
    <div class="metric-card" onclick="filterByRisk('CRITICAL')">
      <div style="color: var(--text-muted); font-size: 12.5px; font-weight: 600;">🔴 Critical Risks (CPs)</div>
      <div class="metric-val val-critical">${criticalCount}</div>
    </div>
    <div class="metric-card" onclick="filterByRisk('HIGH')">
      <div style="color: var(--text-muted); font-size: 12.5px; font-weight: 600;">🟠 High Risks</div>
      <div class="metric-val val-high">${highCount}</div>
    </div>
    <div class="metric-card" onclick="filterByRisk('MEDIUM')">
      <div style="color: var(--text-muted); font-size: 12.5px; font-weight: 600;">🟡 Medium Risks</div>
      <div class="metric-val val-med">${medCount}</div>
    </div>
    <div class="metric-card" onclick="filterByRisk('LOW')">
      <div style="color: var(--text-muted); font-size: 12.5px; font-weight: 600;">🟢 Clean / Low Risks</div>
      <div class="metric-val val-low">${lowCount}</div>
    </div>
  </div>

  <!-- Interactive Search & Filtering Toolbar -->
  <div class="toolbar-container">
    <div class="toolbar-top">
      <div class="search-wrapper">
        <svg class="search-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input type="text" id="searchInput" class="search-input" placeholder="Search agreements, counterparties, clauses, deal actions, or keywords... (Press / to search)" autocomplete="off">
      </div>

      <select id="contractFilter" class="filter-select">
        <option value="ALL">All Agreements (${results.length})</option>
        ${uniqueContracts.map(c => `<option value="${c.replace(/"/g, '&quot;')}">${c.length > 36 ? c.substring(0, 34) + '...' : c}</option>`).join('')}
      </select>

      <select id="clauseFilter" class="filter-select">
        <option value="ALL">All Clause Types</option>
        ${uniqueCategories.map(cat => `<option value="${cat.replace(/"/g, '&quot;')}">${cat}</option>`).join('')}
      </select>

      <select id="cpFilter" class="filter-select">
        <option value="ALL">All Closing Conditions</option>
        <option value="YES">Mandatory Closing CPs Only</option>
        <option value="NO">Standard / Non-CP Findings</option>
      </select>
    </div>

    <div class="toolbar-middle">
      <span class="filter-label">Risk Severity:</span>
      <div class="filter-pill active" data-risk="ALL" onclick="filterByRisk('ALL')">All (${totalFindings})</div>
      <div class="filter-pill" data-risk="CRITICAL" onclick="filterByRisk('CRITICAL')">🔴 Critical (${criticalFindings})</div>
      <div class="filter-pill" data-risk="HIGH" onclick="filterByRisk('HIGH')">🟠 High (${highFindings})</div>
      <div class="filter-pill" data-risk="MEDIUM" onclick="filterByRisk('MEDIUM')">🟡 Medium (${medFindings})</div>
      <div class="filter-pill" data-risk="LOW" onclick="filterByRisk('LOW')">🟢 Low / Clean (${lowFindings})</div>
    </div>

    <div class="toolbar-bottom">
      <span id="resultsStats">Showing <strong>${totalFindings}</strong> of ${totalFindings} clauses across <strong>${results.length}</strong> agreements</span>
      <div style="display: flex; gap: 14px; align-items: center;">
        <button class="btn-export-toolbar" onclick="exportToExcel()">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export to Excel
        </button>
        <button id="resetFiltersBtn" class="btn-reset" onclick="resetAllFilters()">Reset all filters</button>
      </div>
    </div>
  </div>

  <div class="section-title">🚨 Mandatory Closing Conditions Precedent (CP)</div>
  <div class="section-subtitle">High-priority third-party consents and waivers required prior to closing:</div>
  <table id="cpTable">
    <thead>
      <tr>
        <th style="width: 80px;">CP Code</th>
        <th style="width: 250px;">Contract & Counterparty</th>
        <th>Pre-Closing Action Item</th>
        <th>Failure Risk</th>
      </tr>
    </thead>
    <tbody>
      ${(() => {
        let rows = '';
        let cpIdx = 1;
        results.forEach(r => {
          if (r.closingCPRequired) {
            r.findings.forEach(f => {
              const isCP = (f.severity === 'CRITICAL' || f.severity === 'HIGH') && f.consentRequired;
              const isAffiliate = f.affiliateRisk;
              if (isCP || isAffiliate) {
                const failText = isAffiliate ? 'Buyer & Affiliates contaminated by post-closing non-compete.' : `${f.analysis.split('.')[0]}.`;
                const searchData = `${r.contractTitle} ${r.parties.join(' ')} ${f.action} ${failText}`.toLowerCase().replace(/"/g, '&quot;');
                rows += `<tr data-contract="${r.contractTitle.replace(/"/g, '&quot;')}" data-parties="${r.parties.join(', ').replace(/"/g, '&quot;')}" data-risk="${f.severity}" data-action="${f.action.replace(/"/g, '&quot;')}" data-fail="${failText.replace(/"/g, '&quot;')}" data-search="${searchData}">
                  <td><strong>CP-${cpIdx++}</strong></td>
                  <td><strong>${r.contractTitle}</strong><br><small style="color: var(--text-muted);">${r.parties.join(', ')}</small></td>
                  <td>${f.action}</td>
                  <td style="color: var(--critical); font-weight: 500;">${failText}</td>
                </tr>`;
              }
            });
          }
        });
        return rows;
      })()}
      <tr id="cpEmptyState" class="empty-row" style="display: none;">
        <td colspan="4">No mandatory closing conditions match the current search or filters.</td>
      </tr>
    </tbody>
  </table>

  <div class="section-title">📋 Comprehensive Red Flag Due Diligence Matrix</div>
  <div class="section-subtitle">Granular clause breakdown with verbatim quotes and transactional risk annotations:</div>
  <table id="matrixTable">
    <thead>
      <tr>
        <th style="width: 200px;">Contract</th>
        <th style="width: 170px;">Clause Type</th>
        <th style="width: 100px;">Risk Level</th>
        <th style="width: 100px;">Consent Req?</th>
        <th>Legal Analysis & Prescribed Deal Action</th>
      </tr>
    </thead>
    <tbody>
      ${results.map(r => r.findings.map(f => {
        const tagClass = f.severity === 'CRITICAL' ? 'tag-critical' : f.severity === 'HIGH' ? 'tag-high' : f.severity === 'MEDIUM' ? 'tag-med' : 'tag-low';
        const searchData = `${r.contractTitle} ${r.parties.join(' ')} ${r.governingLaw} ${f.category} ${f.severity} ${f.analysis} ${f.action} ${f.quote}`.toLowerCase().replace(/"/g, '&quot;');
        return `<tr data-contract="${r.contractTitle.replace(/"/g, '&quot;')}" data-parties="${r.parties.join(', ').replace(/"/g, '&quot;')}" data-law="${r.governingLaw.replace(/"/g, '&quot;')}" data-risk="${f.severity}" data-clause="${f.category.replace(/"/g, '&quot;')}" data-cp="${f.consentRequired ? 'YES' : 'NO'}" data-analysis="${f.analysis.replace(/"/g, '&quot;')}" data-action="${f.action.replace(/"/g, '&quot;')}" data-search="${searchData}">
          <td><strong>${r.contractTitle}</strong><br><small style="color: var(--text-muted);">${r.parties[0]} / ${r.governingLaw}</small></td>
          <td>${f.category}</td>
          <td><span class="tag ${tagClass}">${f.severity}</span></td>
          <td>${f.consentRequired ? '<strong style="color: var(--critical);">YES</strong>' : '<span style="color: var(--text-muted);">NO</span>'}</td>
          <td>
            <strong>Analysis:</strong> ${f.analysis}<br>
            <div style="margin-top: 4px;"><strong>Action:</strong> ${f.action}</div>
            <details>
              <summary>View Verbatim Contract Excerpt</summary>
              <div class="quote-box">"${f.quote.replace(/</g, '&lt;').replace(/>/g, '&gt;')}"</div>
            </details>
          </td>
        </tr>`;
      }).join('')).join('')}
      <tr id="matrixEmptyState" class="empty-row" style="display: none;">
        <td colspan="5">No contract clauses match the current search or filters. Click "Reset all filters" to restore all agreements.</td>
      </tr>
    </tbody>
  </table>

  <script>
    let currentRisk = 'ALL';

    function filterByRisk(risk) {
      currentRisk = risk;
      document.querySelectorAll('.filter-pill[data-risk]').forEach(pill => {
        if (pill.getAttribute('data-risk') === risk) {
          pill.classList.add('active');
        } else {
          pill.classList.remove('active');
        }
      });
      applyFilters();
    }

    function applyFilters() {
      const searchInput = document.getElementById('searchInput');
      const contractFilter = document.getElementById('contractFilter');
      const clauseFilter = document.getElementById('clauseFilter');
      const cpFilter = document.getElementById('cpFilter');
      const resultsStats = document.getElementById('resultsStats');
      const resetBtn = document.getElementById('resetFiltersBtn');

      const query = (searchInput.value || '').trim().toLowerCase();
      const selectedContract = contractFilter.value;
      const selectedClause = clauseFilter.value;
      const selectedCP = cpFilter.value;

      const hasActiveFilter = query !== '' || currentRisk !== 'ALL' || selectedContract !== 'ALL' || selectedClause !== 'ALL' || selectedCP !== 'ALL';
      resetBtn.style.display = hasActiveFilter ? 'inline' : 'none';

      // 1. Filter Matrix Table
      const matrixRows = document.querySelectorAll('#matrixTable tbody tr:not(#matrixEmptyState)');
      let matchedMatrix = 0;
      const matchingContracts = new Set();

      matrixRows.forEach(row => {
        const rowContract = row.getAttribute('data-contract') || '';
        const rowRisk = row.getAttribute('data-risk') || '';
        const rowClause = row.getAttribute('data-clause') || '';
        const rowCP = row.getAttribute('data-cp') || '';
        const rowSearch = row.getAttribute('data-search') || '';

        const matchQuery = !query || rowSearch.includes(query);
        const matchRisk = (currentRisk === 'ALL') || (rowRisk === currentRisk);
        const matchContract = (selectedContract === 'ALL') || (rowContract === selectedContract);
        const matchClause = (selectedClause === 'ALL') || (rowClause === selectedClause);
        const matchCP = (selectedCP === 'ALL') || (rowCP === selectedCP);

        if (matchQuery && matchRisk && matchContract && matchClause && matchCP) {
          row.style.display = '';
          matchedMatrix++;
          matchingContracts.add(rowContract);
        } else {
          row.style.display = 'none';
        }
      });

      const matrixEmptyState = document.getElementById('matrixEmptyState');
      if (matrixEmptyState) {
        matrixEmptyState.style.display = matchedMatrix === 0 ? '' : 'none';
      }

      // 2. Filter CP Table
      const cpRows = document.querySelectorAll('#cpTable tbody tr:not(#cpEmptyState)');
      let matchedCP = 0;

      cpRows.forEach(row => {
        const rowContract = row.getAttribute('data-contract') || '';
        const rowRisk = row.getAttribute('data-risk') || '';
        const rowSearch = row.getAttribute('data-search') || '';

        const matchQuery = !query || rowSearch.includes(query);
        const matchContract = (selectedContract === 'ALL') || (rowContract === selectedContract);
        const matchRisk = (currentRisk === 'ALL') || (rowRisk === currentRisk);
        const matchCP = (selectedCP === 'ALL') || (selectedCP === 'YES');

        if (matchQuery && matchContract && matchRisk && matchCP) {
          row.style.display = '';
          matchedCP++;
        } else {
          row.style.display = 'none';
        }
      });

      const cpEmptyState = document.getElementById('cpEmptyState');
      if (cpEmptyState) {
        cpEmptyState.style.display = matchedCP === 0 ? '' : 'none';
      }

      if (resultsStats) {
        resultsStats.innerHTML = 'Showing <strong>' + matchedMatrix + '</strong> of ' + matrixRows.length + ' clauses across <strong>' + matchingContracts.size + '</strong> agreements';
      }
    }

    function resetAllFilters() {
      document.getElementById('searchInput').value = '';
      document.getElementById('contractFilter').value = 'ALL';
      document.getElementById('clauseFilter').value = 'ALL';
      document.getElementById('cpFilter').value = 'ALL';
      filterByRisk('ALL');
    }

    document.getElementById('searchInput').addEventListener('input', applyFilters);
    document.getElementById('contractFilter').addEventListener('change', applyFilters);
    document.getElementById('clauseFilter').addEventListener('change', applyFilters);
    document.getElementById('cpFilter').addEventListener('change', applyFilters);

    // Keyboard shortcut '/' to search
    window.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.focus();
      }
    });

    function exportToExcel() {
      const exportBtns = document.querySelectorAll('#exportExcelBtn, .btn-export-toolbar');
      exportBtns.forEach(btn => {
        btn.setAttribute('data-orig-html', btn.innerHTML);
        btn.innerHTML = '<span>Exporting...</span>';
      });

      // Collect visible matrix rows
      const matrixRows = document.querySelectorAll('#matrixTable tbody tr:not(#matrixEmptyState)');
      const matrixExport = [];

      matrixRows.forEach(row => {
        if (row.style.display !== 'none') {
          const contract = row.getAttribute('data-contract') || '';
          const parties = row.getAttribute('data-parties') || '';
          const law = row.getAttribute('data-law') || '';
          const subInfo = parties ? parties + ' / ' + law : law;
          const clauseType = row.getAttribute('data-clause') || '';
          const riskLevel = row.getAttribute('data-risk') || '';
          const consentReq = row.getAttribute('data-cp') || '';
          const actionText = row.getAttribute('data-action') || '';
          const analysisText = row.getAttribute('data-analysis') || '';
          const quoteEl = row.querySelector('.quote-box');
          const quoteText = quoteEl ? quoteEl.innerText.replace(/^"|"$/g, '').trim() : '';

          matrixExport.push({
            'Contract Title': contract,
            'Counterparty & Governing Law': subInfo,
            'Clause Category': clauseType,
            'Risk Severity': riskLevel,
            'Closing Consent Required?': consentReq,
            'Pre-Closing Recommended Action': actionText,
            'Legal Analysis & Deal Impact': analysisText,
            'Verbatim Contract Excerpt': quoteText
          });
        }
      });

      // Collect visible CP rows
      const cpRows = document.querySelectorAll('#cpTable tbody tr:not(#cpEmptyState)');
      const cpExport = [];

      cpRows.forEach(row => {
        if (row.style.display !== 'none') {
          const cpCode = (row.querySelector('td:nth-child(1)')?.innerText || '').trim();
          const contractTitle = row.getAttribute('data-contract') || '';
          const counterparties = row.getAttribute('data-parties') || '';
          const actionItem = row.getAttribute('data-action') || '';
          const failureRisk = row.getAttribute('data-fail') || '';

          cpExport.push({
            'CP Code': cpCode,
            'Contract Title': contractTitle,
            'Counterparties': counterparties,
            'Pre-Closing Action Item': actionItem,
            'Failure Risk & Deal Impact': failureRisk
          });
        }
      });

      // Executive Summary Sheet
      const summaryExport = [
        { 'Parameter': 'Deal Name', 'Value': '${dealName}' },
        { 'Parameter': 'Target Company', 'Value': '${targetName}' },
        { 'Parameter': 'Audit Date', 'Value': '${dateStr}' },
        { 'Parameter': 'Total Contracts Audited', 'Value': ${results.length} },
        { 'Parameter': 'Exported Clauses (Filtered View)', 'Value': matrixExport.length },
        { 'Parameter': 'Exported Closing Conditions (CP)', 'Value': cpExport.length },
        { 'Parameter': 'Critical Risks Identified', 'Value': ${criticalCount} },
        { 'Parameter': 'High Risks Identified', 'Value': ${highCount} },
        { 'Parameter': 'Medium Risks Identified', 'Value': ${medCount} },
        { 'Parameter': 'Clean / Low Risks', 'Value': ${lowCount} },
        { 'Parameter': 'Legal Classification', 'Value': 'ATTORNEY-CLIENT PRIVILEGED / CONFIDENTIAL' }
      ];

      const filename = 'Project_Titan_Due_Diligence_Matrix';

      if (typeof XLSX !== 'undefined') {
        try {
          const wb = XLSX.utils.book_new();

          const wsMatrix = XLSX.utils.json_to_sheet(matrixExport);
          wsMatrix['!cols'] = [
            { wch: 32 },
            { wch: 30 },
            { wch: 26 },
            { wch: 14 },
            { wch: 22 },
            { wch: 45 },
            { wch: 55 },
            { wch: 60 }
          ];

          const wsCP = XLSX.utils.json_to_sheet(cpExport);
          wsCP['!cols'] = [
            { wch: 12 },
            { wch: 35 },
            { wch: 32 },
            { wch: 50 },
            { wch: 50 }
          ];

          const wsSummary = XLSX.utils.json_to_sheet(summaryExport);
          wsSummary['!cols'] = [
            { wch: 32 },
            { wch: 45 }
          ];

          XLSX.utils.book_append_sheet(wb, wsMatrix, 'Red Flag Matrix');
          XLSX.utils.book_append_sheet(wb, wsCP, 'Closing Conditions (CP)');
          XLSX.utils.book_append_sheet(wb, wsSummary, 'Deal Summary');

          XLSX.writeFile(wb, filename + '.xlsx');
        } catch (err) {
          console.error('XLSX export error, falling back to CSV:', err);
          fallbackCSVExport(matrixExport, filename + '.csv');
        }
      } else {
        fallbackCSVExport(matrixExport, filename + '.csv');
      }

      exportBtns.forEach(btn => {
        btn.innerHTML = '<span>✓ Exported to Excel!</span>';
        setTimeout(() => {
          const orig = btn.getAttribute('data-orig-html');
          if (orig) btn.innerHTML = orig;
        }, 2200);
      });
    }

    function fallbackCSVExport(rows, filename) {
      if (!rows.length) return;
      const headers = Object.keys(rows[0]);
      let csvContent = '\\uFEFF' + headers.map(h => '"' + h.replace(/"/g, '""') + '"').join(',') + '\\r\\n';
      rows.forEach(r => {
        const rowStr = headers.map(h => {
          const val = (r[h] || '').toString();
          return '"' + val.replace(/"/g, '""') + '"';
        }).join(',');
        csvContent += rowStr + '\\r\\n';
      });
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => document.body.removeChild(link), 100);
    }
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, html, 'utf-8');
}

// CLI Argument Parsing
function parseCLIArgs() {
  const args = process.argv.slice(2);
  let deal = process.env.DEAL_NAME || 'Project Titan Acquisition';
  let target = process.env.TARGET_NAME || 'Target Technologies Corp.';
  let contractsDir = null;
  let shouldOpen = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--deal=') || a.startsWith('--deal-name=')) {
      deal = a.substring(a.indexOf('=') + 1).replace(/^["']|["']$/g, '');
    } else if (a === '--deal' || a === '--deal-name') {
      if (i + 1 < args.length) deal = args[++i].replace(/^["']|["']$/g, '');
    } else if (a.startsWith('--target=') || a.startsWith('--target-name=')) {
      target = a.substring(a.indexOf('=') + 1).replace(/^["']|["']$/g, '');
    } else if (a === '--target' || a === '--target-name') {
      if (i + 1 < args.length) target = args[++i].replace(/^["']|["']$/g, '');
    } else if (a.startsWith('--contracts=') || a.startsWith('--input=')) {
      contractsDir = a.substring(a.indexOf('=') + 1).replace(/^["']|["']$/g, '');
    } else if (a === '--contracts' || a === '--input') {
      if (i + 1 < args.length) contractsDir = args[++i].replace(/^["']|["']$/g, '');
    } else if (a === '--open') {
      shouldOpen = true;
    }
  }
  return { dealName: deal, targetName: target, contractsDir, shouldOpen };
}

function getProjectSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

const { dealName, targetName, contractsDir: cliContractsDir, shouldOpen } = parseCLIArgs();
const projectSlug = getProjectSlug(dealName);

// Resolve Contracts Input Directory:
// 1. Specified via CLI
// 2. contracts/<projectSlug> if it exists
// 3. Fallback to contracts/ root
let activeContractsDir = path.join(__dirname, 'contracts');
if (cliContractsDir && fs.existsSync(cliContractsDir)) {
  activeContractsDir = path.resolve(cliContractsDir);
} else {
  const subContractsDir = path.join(__dirname, 'contracts', projectSlug);
  if (fs.existsSync(subContractsDir)) {
    activeContractsDir = subContractsDir;
  }
}

// Resolve Reports Output Directory:
// Each project gets its own isolated folder: reports/<projectSlug>/
const dealReportsDir = path.join(REPORTS_DIR, projectSlug);
if (!fs.existsSync(dealReportsDir)) {
  fs.mkdirSync(dealReportsDir, { recursive: true });
}

// MAIN EXECUTION
console.log('='.repeat(70));
console.log('⚖️  LEGAL M&A DUE DILIGENCE AUTOMATION RUNNER');
console.log(`💼 Transaction : ${dealName}`);
console.log(`🎯 Target      : ${targetName}`);
console.log(`📁 Input Room  : ${activeContractsDir}`);
console.log(`📊 Output Room : ${dealReportsDir}`);
console.log('='.repeat(70));

// Find all files (.pdf or .txt) and prefer .pdf when both exist
const rawFiles = fs.readdirSync(activeContractsDir).filter(f => f.endsWith('.pdf') || f.endsWith('.txt')).sort();
const fileMap = new Map();
rawFiles.forEach(f => {
  const base = f.replace(/\.(pdf|txt)$/i, '');
  if (!fileMap.has(base) || f.endsWith('.pdf')) {
    fileMap.set(base, f);
  }
});
const files = Array.from(fileMap.values()).sort();
const results = [];

files.forEach(f => {
  const filePath = path.join(activeContractsDir, f);
  const isPdf = f.endsWith('.pdf');
  console.log(`[*] Ingesting & Analyzing (${isPdf ? 'PDF' : 'TXT'}): ${f}...`);
  const text = isPdf ? extractTextFromPDF(filePath) : fs.readFileSync(filePath, 'utf-8');
  const res = analyzeContract(f, text);
  results.push(res);
  console.log(`    -> Title: ${res.contractTitle}`);
  console.log(`    -> Risk: ${res.overallRisk} | Findings: ${res.findings.length} | CP: ${res.closingCPRequired ? 'YES' : 'NO'}`);
});

const pdfPath = path.join(dealReportsDir, 'due_diligence_report.pdf');
const mdPath = path.join(dealReportsDir, 'due_diligence_report.md');
const csvPath = path.join(dealReportsDir, 'due_diligence_red_flag_matrix.csv');
const htmlPath = path.join(dealReportsDir, 'due_diligence_dashboard.html');

generateDueDiligencePDFReport(dealName, targetName, results, pdfPath);
generateMarkdownReport(dealName, targetName, results, mdPath);
generateCSVMatrix(results, csvPath);
generateHTMLDashboard(dealName, targetName, results, htmlPath);

// Security & CV Portfolio Sync Check:
const isTitanDemo = projectSlug.includes('titan');
if (isTitanDemo) {
  // Mirror to root reports/ for default access
  fs.copyFileSync(htmlPath, path.join(REPORTS_DIR, 'due_diligence_dashboard.html'));
  fs.copyFileSync(pdfPath, path.join(REPORTS_DIR, 'due_diligence_report.pdf'));
  fs.copyFileSync(csvPath, path.join(REPORTS_DIR, 'due_diligence_red_flag_matrix.csv'));
  fs.copyFileSync(mdPath, path.join(REPORTS_DIR, 'due_diligence_report.md'));

  // Sync to CV/reports/ for GitHub Pages portfolio
  const cvReportsDir = path.join(__dirname, 'CV', 'reports');
  if (fs.existsSync(cvReportsDir)) {
    fs.copyFileSync(htmlPath, path.join(cvReportsDir, 'due_diligence_dashboard.html'));
    fs.copyFileSync(pdfPath, path.join(cvReportsDir, 'due_diligence_report.pdf'));
    fs.copyFileSync(csvPath, path.join(cvReportsDir, 'due_diligence_red_flag_matrix.csv'));
    fs.copyFileSync(mdPath, path.join(cvReportsDir, 'due_diligence_report.md'));
    console.log('🔄 Synced Project Titan demo reports to CV/reports/ for GitHub Pages!');
  }
} else {
  console.log('🔒 Confidentiality Protection Active:');
  console.log(`   -> Reports isolated strictly to: ${dealReportsDir}`);
  console.log('   -> Public CV/portfolio sync SKIPPED to protect client privilege & NDAs.');
}

console.log('-'.repeat(70));
console.log('✅ Pipeline Execution Complete!');
console.log(`📕 PDF Report:       ${pdfPath}`);
console.log(`📄 Markdown Report:  ${mdPath}`);
console.log(`📊 CSV Risk Matrix:  ${csvPath}`);
console.log(`🌐 HTML Dashboard:   ${htmlPath}`);
console.log('='.repeat(70));

if (shouldOpen) {
  const { exec } = require('child_process');
  exec(`start "" "${pdfPath}"`);
  exec(`start "" "${htmlPath}"`);
}
