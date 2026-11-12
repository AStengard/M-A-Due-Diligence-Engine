"""
Report generation module for M&A Due Diligence.
Generates comprehensive Markdown executive reports and CSV / Excel risk matrices.
"""

import csv
import os
from typing import List
from .models import ContractAnalysisResult, DueDiligenceReport, RiskSeverity


class ReportBuilder:
    """Builds Markdown reports and tabular risk matrices."""

    def build_markdown_report(self, report: DueDiligenceReport, output_path: str) -> str:
        """Generates an executive-ready M&A Due Diligence Markdown document."""
        lines = []
        lines.append(f"# M&A Legal Due Diligence: Red Flag & Transaction Matrix")
        lines.append(f"**Target Company:** {report.target_company}  ")
        lines.append(f"**Transaction:** {report.deal_name}  ")
        lines.append(f"**Date:** November 2026 | **Status:** Confidential / Attorney-Client Privileged\n")
        lines.append("---\n")

        # Executive Summary Section
        lines.append("## 1. Executive Summary & Risk Heatmap\n")
        lines.append("| Metric | Count | Deal Implication |")
        lines.append("| :--- | :---: | :--- |")
        lines.append(f"| **Total Material Contracts Analyzed** | **{report.contracts_analyzed}** | Complete sample audit |")
        lines.append(f"| 🔴 **Critical Risks** | **{report.critical_risks_count}** | **Mandatory Conditions Precedent (CP)** or Buyer contamination risk |")
        lines.append(f"| 🟠 **High Risks** | **{report.high_risks_count}** | Prior consent required / revenue walk-away exposure |")
        lines.append(f"| 🟡 **Medium Risks** | **{report.medium_risks_count}** | Reasonableness qualified / deal structure dependent |")
        lines.append(f"| 🟢 **Low / Clean** | **{report.low_risks_count}** | Standard M&A carve-out or post-closing notice only |\n")

        # Critical Closing Conditions Precedent (CP) Checklist
        lines.append("## 2. Mandatory Closing Conditions Precedent (CP) Checklist\n")
        lines.append("The following third-party consents and waivers must be obtained **prior to closing** to prevent catastrophic breach, contract termination, or Buyer contamination:\n")
        lines.append("| # | Contract / Counterparty | Required Pre-Closing Action | Risk if Unobtained |")
        lines.append("| :-: | :--- | :--- | :--- |")

        cp_counter = 1
        for res in report.results:
            if res.closing_condition_precedent_required:
                for finding in res.findings:
                    if finding.severity in (RiskSeverity.CRITICAL, RiskSeverity.HIGH) and finding.consent_required:
                        lines.append(
                            f"| CP-{cp_counter} | **{res.contract_title}**<br>*{', '.join(res.parties)}* | "
                            f"{finding.recommended_action} | "
                            f"{finding.legal_analysis.split('.')[0]}. |"
                        )
                        cp_counter += 1
                    elif finding.affiliate_contamination_risk:
                        lines.append(
                            f"| CP-{cp_counter} | **{res.contract_title}**<br>*{', '.join(res.parties)}* | "
                            f"{finding.recommended_action} | "
                            f"Buyer and all Buyer Affiliates bound by territorial non-compete post-closing! |"
                        )
                        cp_counter += 1

        lines.append("\n---\n")

        # Master Due Diligence Matrix Table
        lines.append("## 3. Master Red Flag Due Diligence Matrix\n")
        lines.append("| Contract Title | Category | Severity | Consent Req? | Standard | Deal Impact & Required Action |")
        lines.append("| :--- | :--- | :---: | :---: | :--- | :--- |")

        for res in report.results:
            for f in res.findings:
                sev_icon = {
                    RiskSeverity.CRITICAL: "🔴 **CRITICAL**",
                    RiskSeverity.HIGH: "🟠 **HIGH**",
                    RiskSeverity.MEDIUM: "🟡 **MEDIUM**",
                    RiskSeverity.LOW: "🟢 **LOW**",
                    RiskSeverity.INFORMATIONAL: "⚪ INFO"
                }.get(f.severity, f.severity.value)

                consent_badge = "⚠️ **YES**" if f.consent_required else "No"
                lines.append(
                    f"| **{res.contract_title}** | {f.category.value} | {sev_icon} | {consent_badge} | "
                    f"{f.consent_standard.value} | **Analysis:** {f.legal_analysis}<br>**Action:** {f.recommended_action} |"
                )

        lines.append("\n---\n")

        # Detailed Verbatim Findings & Citations
        lines.append("## 4. Contract-by-Contract Detailed Audit with Verbatim Citations\n")
        for idx, res in enumerate(report.results, 1):
            lines.append(f"### 4.{idx} {res.contract_title}")
            lines.append(f"- **Parties:** {', '.join(res.parties)}")
            lines.append(f"- **Governing Law:** {res.governing_law} | **Effective Date:** {res.effective_date}")
            lines.append(f"- **Overall Risk Rating:** `{res.overall_contract_risk.value}`")
            lines.append(f"- **Condition Precedent Required:** `{'YES' if res.closing_condition_precedent_required else 'NO'}`")
            lines.append(f"- **Disclosure Schedule Entry:** `{'YES (Schedule 3.4/3.16)' if res.disclosure_schedule_required else 'NO'}`\n")

            lines.append("#### Clause Extracts & Risk Annotations:")
            for f in res.findings:
                lines.append(f"> **[{f.category.value} - {f.severity.value}]**")
                lines.append(f"> *\"{f.verbatim_quote.strip()}\"*\n")
                lines.append(f"- **Legal Assessment:** {f.legal_analysis}")
                lines.append(f"- **Prescribed Deal Action:** {f.recommended_action}\n")
            lines.append("\n")

        content = "\n".join(lines)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(content)
        return content

    def build_csv_matrix(self, report: DueDiligenceReport, output_path: str):
        """Generates a CSV matrix suitable for Excel import and VDR tracker use."""
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        headers = [
            "Contract File",
            "Contract Title",
            "Parties",
            "Governing Law",
            "Clause Category",
            "Risk Severity",
            "Consent Required",
            "Consent Standard",
            "Notice Period (Days)",
            "Closing Termination Risk",
            "Affiliate Contamination Risk",
            "Legal Analysis",
            "Recommended Action",
            "Condition Precedent",
            "Verbatim Clause Excerpt"
        ]

        with open(output_path, "w", newline="", encoding="utf-8") as csvfile:
            writer = csv.writer(csvfile)
            writer.writerow(headers)

            for res in report.results:
                for f in res.findings:
                    writer.writerow([
                        res.file_name,
                        res.contract_title,
                        "; ".join(res.parties),
                        res.governing_law,
                        f.category.value,
                        f.severity.value,
                        "YES" if f.consent_required else "NO",
                        f.consent_standard.value,
                        f.notice_period_days if f.notice_period_days is not None else "N/A",
                        "YES" if f.termination_risk_on_closing else "NO",
                        "YES" if f.affiliate_contamination_risk else "NO",
                        f.legal_analysis,
                        f.recommended_action,
                        "YES" if (f.severity in (RiskSeverity.CRITICAL, RiskSeverity.HIGH) and (f.consent_required or f.affiliate_contamination_risk)) else "NO",
                        f.verbatim_quote.replace("\n", " ")
                    ])
