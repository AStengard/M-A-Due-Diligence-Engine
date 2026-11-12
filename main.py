"""
Main entry point for Legal M&A Due Diligence Automation.
Ingests commercial contracts (PDF or TXT), extracts Change of Control, Assignment,
and Restrictive Covenants, evaluates risk severity, and exports executive reports and matrices.
"""

import argparse
import glob
import os
import re
import sys
import zlib
from src.models import DueDiligenceReport, ContractAnalysisResult, RiskSeverity
from src.clause_extractor import ClauseExtractor
from src.risk_evaluator import RiskEvaluator
from src.report_builder import ReportBuilder


def extract_text_from_pdf(file_path: str) -> str:
    """Extracts plain text from a PDF file using pypdf if installed, or built-in stream parser."""
    try:
        import pypdf
        reader = pypdf.PdfReader(file_path)
        pages = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(pages).strip()
    except ImportError:
        pass

    # Built-in zero-dependency fallback PDF extractor
    with open(file_path, "rb") as f:
        data = f.read()

    text_chunks = []
    pos = 0
    while pos < len(data):
        stream_start = data.find(b"stream", pos)
        if stream_start == -1:
            break
        content_start = stream_start + 6
        if data[content_start : content_start + 2] == b"\r\n":
            content_start += 2
        elif data[content_start : content_start + 1] in (b"\n", b"\r"):
            content_start += 1

        stream_end = data.find(b"endstream", content_start)
        if stream_end == -1:
            break
        pos = stream_end + 9

        stream_bytes = data[content_start:stream_end]
        try:
            decomp = zlib.decompress(stream_bytes).decode("latin1", errors="ignore")
        except Exception:
            decomp = stream_bytes.decode("latin1", errors="ignore")

        bt_blocks = re.findall(r"BT([\s\S]*?)ET", decomp)
        for block in bt_blocks:
            matches = re.findall(r"\((.*?)\)\s*(?:Tj|'|\")|\[([\s\S]*?)\]\s*TJ", block)
            block_parts = []
            for m1, m2 in matches:
                if m1:
                    block_parts.append(m1)
                elif m2:
                    inner_matches = re.findall(r"\((.*?)\)", m2)
                    block_parts.append("".join(inner_matches))
            if block_parts:
                text_chunks.append(" ".join(block_parts))

    return "\n\n".join(text_chunks).strip()


def load_contract_text(file_path: str) -> str:
    """Loads contract text from either PDF or TXT."""
    if file_path.lower().endswith(".pdf"):
        return extract_text_from_pdf(file_path)
    with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()


def process_contract(file_path: str, extractor: ClauseExtractor, evaluator: RiskEvaluator) -> ContractAnalysisResult:
    """Reads and analyzes an individual contract."""
    text = load_contract_text(file_path)

    meta = extractor.extract_metadata(text)
    segmented = extractor.segment_clauses(text)

    findings = []
    # 1. Change of Control
    if segmented["change_of_control"]:
        findings.extend(evaluator.evaluate_change_of_control(segmented["change_of_control"]))

    # 2. Assignment
    if segmented["assignment"]:
        findings.extend(evaluator.evaluate_assignment(segmented["assignment"]))

    # 3. Restrictive Covenants / Non-competes
    if segmented["restrictive_covenant"]:
        findings.extend(evaluator.evaluate_restrictive_covenants(segmented["restrictive_covenant"]))

    # 4. Termination for Convenience
    if segmented["termination_convenience"]:
        findings.extend(evaluator.evaluate_termination_convenience(segmented["termination_convenience"]))

    # Determine overall contract risk
    severities = [f.severity for f in findings]
    if RiskSeverity.CRITICAL in severities:
        overall_risk = RiskSeverity.CRITICAL
    elif RiskSeverity.HIGH in severities:
        overall_risk = RiskSeverity.HIGH
    elif RiskSeverity.MEDIUM in severities:
        overall_risk = RiskSeverity.MEDIUM
    elif RiskSeverity.LOW in severities:
        overall_risk = RiskSeverity.LOW
    else:
        overall_risk = RiskSeverity.INFORMATIONAL

    cp_required = any(
        f.severity in (RiskSeverity.CRITICAL, RiskSeverity.HIGH) and (f.consent_required or f.affiliate_contamination_risk)
        for f in findings
    )
    disc_required = len(findings) > 0

    return ContractAnalysisResult(
        file_name=os.path.basename(file_path),
        contract_title=meta["title"],
        parties=meta["parties"],
        effective_date=meta["effective_date"],
        governing_law=meta["governing_law"],
        findings=findings,
        overall_contract_risk=overall_risk,
        closing_condition_precedent_required=cp_required,
        disclosure_schedule_required=disc_required
    )


def run_pipeline(input_dir: str, output_dir: str, deal_name: str, target_name: str):
    print("=" * 70)
    print("⚖️  LEGAL M&A AUTOMATION: CONTRACT DUE DILIGENCE PIPELINE")
    print("=" * 70)
    print(f"Deal Name:    {deal_name}")
    print(f"Target:       {target_name}")
    print(f"Input Folder: {input_dir}")
    print(f"Output Dir:   {output_dir}")
    print("-" * 70)

    extractor = ClauseExtractor()
    evaluator = RiskEvaluator()
    builder = ReportBuilder()

    all_files = glob.glob(os.path.join(input_dir, "*.*"))
    target_exts = (".pdf", ".txt")
    candidates = [f for f in all_files if f.lower().endswith(target_exts)]

    # Deduplicate: prefer .pdf over .txt
    file_map = {}
    for f in candidates:
        base, ext = os.path.splitext(f)
        if base not in file_map or ext.lower() == ".pdf":
            file_map[base] = f

    contract_files = sorted(file_map.values())

    if not contract_files:
        print(f"[-] No .pdf or .txt contract files found in {input_dir}")
        return

    results = []
    for filepath in contract_files:
        ext = os.path.splitext(filepath)[1].upper()
        print(f"[*] Ingesting & Analyzing ({ext[1:]}): {os.path.basename(filepath)}...")
        res = process_contract(filepath, extractor, evaluator)
        results.append(res)
        print(f"    -> Title: {res.contract_title}")
        print(f"    -> Overall Risk: {res.overall_contract_risk.value} | Findings: {len(res.findings)}")
        if res.closing_condition_precedent_required:
            print("    -> ⚠️  CLOSING CONDITION PRECEDENT (CP) REQUIRED")

    # Aggregate metrics
    critical_c = sum(1 for r in results if r.overall_contract_risk == RiskSeverity.CRITICAL)
    high_c = sum(1 for r in results if r.overall_contract_risk == RiskSeverity.HIGH)
    med_c = sum(1 for r in results if r.overall_contract_risk == RiskSeverity.MEDIUM)
    low_c = sum(1 for r in results if r.overall_contract_risk == RiskSeverity.LOW)

    report = DueDiligenceReport(
        deal_name=deal_name,
        target_company=target_name,
        contracts_analyzed=len(results),
        critical_risks_count=critical_c,
        high_risks_count=high_c,
        medium_risks_count=med_c,
        low_risks_count=low_c,
        results=results
    )

    md_path = os.path.join(output_dir, "due_diligence_report.md")
    csv_path = os.path.join(output_dir, "due_diligence_red_flag_matrix.csv")

    builder.build_markdown_report(report, md_path)
    builder.build_csv_matrix(report, csv_path)

    print("-" * 70)
    print("✅ Due Diligence Analysis Complete!")
    print(f"📄 Markdown Report: {md_path}")
    print(f"📊 Red Flag Matrix: {csv_path}")
    print(f"Summary: {critical_c} Critical | {high_c} High | {med_c} Medium | {low_c} Low")
    print("=" * 70)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Legal M&A Due Diligence Automation Pipeline")
    parser.add_argument("--input-dir", default="./contracts", help="Directory containing contract files")
    parser.add_argument("--output-dir", default="./reports", help="Directory to save generated reports")
    parser.add_argument("--deal-name", default="Project Titan Acquisition", help="Name of M&A transaction")
    parser.add_argument("--target", default="Target Technologies Corp.", help="Target company name")

    args = parser.parse_args()
    run_pipeline(args.input_dir, args.output_dir, args.deal_name, args.target)
