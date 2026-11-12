# Legal M&A Due Diligence Automation Prototype

An automated legal pipeline that ingests commercial contracts (PDF and TXT), extracts key transactional clauses (Change of Control, Assignment, Exclusivity/Non-Compete, Termination for Convenience), performs risk scoring according to standard M&A playbooks, and generates formatted Red Flag Due Diligence Reports in **PDF**, **HTML Dashboard**, **Markdown**, and **CSV Matrix**.

## Features

- **Native PDF & TXT Ingestion**:
  - Ingests scanned or digital PDF contracts directly from data rooms.
  - Zero-dependency built-in PDF text extractor handles compressed streams (`FlateDecode`), font matrices, character unescaping, and section parsing.
- **Automated Clause Segmentation & Detection**:
  - **Change of Control (CoC)**: Analyzes trigger thresholds (>50% voting stock, asset sale, merger), consent standards (sole discretion vs reasonable), and termination rights.
  - **Assignment & Transfer**: Identifies "operation of law" restrictions, affiliate carve-outs, and M&A successor exceptions.
  - **Restrictive Covenants**: Flags exclusivity, territory restrictions, and post-closing affiliate non-compete contamination.
  - **Termination for Convenience**: Highlights revenue vulnerability and counterparty walk-away risks.
- **Risk Scoring Engine**:
  - `CRITICAL / HIGH`: Requires Pre-Closing Consent (Condition Precedent), Buyer business contamination risk, or immediate termination exposure.
  - `MEDIUM`: Ambiguous assignment ("operation of law"), consent not to be unreasonably withheld, deal-structure dependent.
  - `LOW / STANDARD`: Pre-approved M&A successor carve-outs, post-closing notification only.
- **Comprehensive Output Formats**:
  - 📕 **Executive PDF Due Diligence Report** (`reports/due_diligence_report.pdf`): Formatted multi-page PDF document featuring executive heatmap stats, closing CP checklists, master risk matrix, and verbatim clause citations.
  - 🌐 **Interactive HTML Dashboard** (`reports/due_diligence_dashboard.html`).
  - 📄 **Legal Memorandum Report** (`reports/due_diligence_report.md`).
  - 📊 **Red Flag Risk Matrix** (`reports/due_diligence_red_flag_matrix.csv`) ready for deal teams and VDR disclosure schedules.

## Directory Structure

```
├── contracts/                  # Raw commercial contracts (PDF / TXT)
│   ├── 01_master_services_agreement_acme.pdf
│   ├── 02_enterprise_saas_agreement_globex.pdf
│   ├── 03_exclusive_distributor_agreement_apex.pdf
│   ├── 04_strategic_partnership_inventure.pdf
│   └── (optional .txt files)
├── reports/                    # Generated diligence reports & deliverables
│   ├── due_diligence_report.pdf            # Publication-grade Executive PDF Report
│   ├── due_diligence_dashboard.html        # Interactive browser dashboard
│   ├── due_diligence_report.md             # Markdown diligence memo
│   └── due_diligence_red_flag_matrix.csv   # Excel-compatible CSV matrix
├── pdf_engine.js               # Zero-dependency PDF extraction and generation engine
├── run_prototype.js            # Standalone runner for the diligence pipeline
├── RUN_DILIGENCE.bat           # 1-Click Windows batch runner
├── main.py                     # Python CLI runner (with PDF support)
├── requirements.txt            # Python dependencies (including pypdf/reportlab)
└── src/                        # Modular Python source code
```

## Running the Pipeline

### Option 1: 1-Click Windows Runner
Double-click `RUN_DILIGENCE.bat`. It will scan all contracts in the `contracts/` directory and open the generated PDF report and HTML dashboard in your default viewer.

### Option 2: Using Node.js
Run directly from terminal:
```powershell
node run_prototype.js
```

### Option 3: Using Python
1. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
2. Run the analysis:
   ```bash
   python main.py --input-dir ./contracts --output-dir ./reports
   ```
