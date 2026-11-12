"""
Legal Risk Evaluation Engine for M&A Due Diligence.
Applies legal analysis playbooks to extracted clauses to score risk severity,
identify closing conditions precedent, and provide actionable deal advice.
"""

import re
from typing import List, Tuple
from .models import (
    ClauseCategory,
    ConsentStandard,
    DueDiligenceFinding,
    RiskSeverity,
)


class RiskEvaluator:
    """Evaluates extracted clauses against standard M&A legal risk playbooks."""

    def evaluate_change_of_control(self, snippets: List[str]) -> List[DueDiligenceFinding]:
        findings = []
        for text in snippets:
            lower = text.lower()

            # Analyze Consent Standard
            if "sole and absolute discretion" in lower or "sole discretion" in lower:
                consent_std = ConsentStandard.SOLE_DISCRETION
            elif "not to be unreasonably withheld" in lower:
                consent_std = ConsentStandard.REASONABLE
            elif "consent" in lower or "prior written consent" in lower or "written approval" in lower:
                consent_std = ConsentStandard.SILENT
            else:
                consent_std = ConsentStandard.NOT_REQUIRED

            consent_required = consent_std != ConsentStandard.NOT_REQUIRED

            # Extract notice period
            notice_match = re.search(r"(\d+)\s*days?\s*prior", text, re.IGNORECASE)
            notice_days = int(notice_match.group(1)) if notice_match else None

            # Termination on breach
            term_risk = any(k in lower for k in [
                "terminate this agreement immediately",
                "right to immediately terminate",
                "incurable material breach",
                "declare this agreement terminated"
            ])

            # Evaluate M&A Carve-Out (e.g. permitted transfer in connection with merger)
            has_carveout = any(k in lower for k in [
                "permitted m&a carve-out",
                "in connection with a merger",
                "without the consent of the other party"
            ])

            if has_carveout and not consent_required:
                severity = RiskSeverity.LOW
                analysis = (
                    "Contains express M&A carve-out permitting transfer via merger or sale of assets/stock. "
                    "Notice required post-closing; no pre-closing consent blocker."
                )
                action = "Post-closing notice compliance (ensure notice delivered within prescribed timeline). No CP needed."
            elif consent_std == ConsentStandard.SOLE_DISCRETION or (term_risk and consent_required):
                severity = RiskSeverity.CRITICAL
                analysis = (
                    "CRITICAL CLOSING BLOCKER: Transaction explicitly triggers Change of Control consent. "
                    "Counterparty holds sole discretion to withhold consent and retains unilateral termination rights "
                    "or clawback remedies upon closing without prior consent."
                )
                action = (
                    "MANDATORY: (1) Include as a closing Condition Precedent (CP) to obtain written counterparty consent; "
                    "(2) List on Seller Disclosure Schedule 3.4 (Consents & Approvals); (3) Formulate pre-signing outreach strategy."
                )
            elif consent_required:
                severity = RiskSeverity.HIGH
                analysis = (
                    "Change of Control requires counterparty consent. While not explicitly subject to sole discretion, "
                    "failure to obtain consent creates risk of contract repudiation or post-closing renegotiation."
                )
                action = "Obtain formal waiver/consent prior to Closing or secure closing condition in Acquisition Agreement."
            else:
                severity = RiskSeverity.MEDIUM
                analysis = "Change of control provisions present; terms require review for indirect ownership transfer thresholds."
                action = "Include on M&A Disclosure Schedule."

            findings.append(DueDiligenceFinding(
                category=ClauseCategory.CHANGE_OF_CONTROL,
                severity=severity,
                consent_required=consent_required,
                consent_standard=consent_std,
                notice_period_days=notice_days,
                termination_risk_on_closing=term_risk,
                verbatim_quote=text,
                legal_analysis=analysis,
                recommended_action=action
            ))
        return findings

    def evaluate_assignment(self, snippets: List[str]) -> List[DueDiligenceFinding]:
        findings = []
        for text in snippets:
            lower = text.lower()

            # Permitted M&A Carve-Out check
            if "permitted" in lower and ("merger" in lower or "sale of all or substantially all" in lower):
                findings.append(DueDiligenceFinding(
                    category=ClauseCategory.ASSIGNMENT,
                    severity=RiskSeverity.LOW,
                    consent_required=False,
                    consent_standard=ConsentStandard.NOT_REQUIRED,
                    notice_period_days=15 if "15" in lower else None,
                    verbatim_quote=text,
                    legal_analysis=(
                        "Standard M&A successor carve-out. Allows assignment without consent in connection with "
                        "a merger or asset/stock acquisition. Check competitor exclusions (Exhibit D)."
                    ),
                    recommended_action="Confirm Buyer is not a listed competitor on Exhibit D; diarize post-closing notice."
                ))
                continue

            # Standard anti-assignment clause
            consent_req = "prior written consent" in lower or "without the other party's" in lower
            by_op_of_law = "operation of law" in lower

            if "not to be unreasonably withheld" in lower:
                consent_std = ConsentStandard.REASONABLE
                severity = RiskSeverity.MEDIUM
                analysis = (
                    "General anti-assignment clause with reasonableness standard. Restricts assignment by 'operation of law'. "
                    "If deal is structured as a Reverse Triangular Merger or stock sale, may not constitute an assignment "
                    "(under Delaware law / Meso Scale doctrine), but Asset Sale or Forward Merger would trigger consent requirement."
                )
                action = (
                    "Review deal structure (Stock vs. Asset). If Asset Sale or Forward Merger, consent required. "
                    "List on Disclosure Schedule 3.4."
                )
            else:
                consent_std = ConsentStandard.SILENT
                severity = RiskSeverity.HIGH
                analysis = (
                    "Strict anti-assignment restriction without reasonableness qualification. "
                    "Potential blocker if transaction involves asset transfer or forward statutory merger."
                )
                action = "Obtain assignment consent prior to closing if structure involves transfer of contracts."

            findings.append(DueDiligenceFinding(
                category=ClauseCategory.ASSIGNMENT,
                severity=severity,
                consent_required=consent_req,
                consent_standard=consent_std,
                verbatim_quote=text,
                legal_analysis=analysis,
                recommended_action=action
            ))
        return findings

    def evaluate_restrictive_covenants(self, snippets: List[str]) -> List[DueDiligenceFinding]:
        findings = []
        for text in snippets:
            lower = text.lower()

            # Check if restriction binds "Affiliates", "successors", or "parent entities"
            affiliate_risk = any(k in lower for k in ["affiliate", "current or future affiliate", "parent entities", "successor"])

            if affiliate_risk and ("non-compete" in lower or "competing" in lower or "exclusive" in lower):
                severity = RiskSeverity.CRITICAL
                analysis = (
                    "HIGH-SEVERITY CONTAMINATION RISK: Restrictive covenant / non-compete explicitly binds Target's "
                    "'current or future Affiliates and parent entities'. Following closing, Buyer and its existing subsidiaries "
                    "would become 'Affiliates' and could be legally prohibited from distributing competing products in the Territory!"
                )
                action = (
                    "DEAL STRUCTURING PRIORITY: (1) Mandatory closing waiver or contract amendment carving out Buyer "
                    "and Buyer's pre-existing affiliates; (2) Alternatively, isolate Target in a remote corporate subsidiary ring-fence."
                )
            else:
                severity = RiskSeverity.HIGH
                analysis = "Exclusivity or territorial restriction limits Target's commercial freedom in North America."
                action = "Disclose on Schedule 3.16 (Material Contracts & Restrictive Covenants)."

            findings.append(DueDiligenceFinding(
                category=ClauseCategory.RESTRICTIVE_COVENANT,
                severity=severity,
                consent_required=False,
                consent_standard=ConsentStandard.NOT_REQUIRED,
                affiliate_contamination_risk=affiliate_risk,
                verbatim_quote=text,
                legal_analysis=analysis,
                recommended_action=action
            ))
        return findings

    def evaluate_termination_convenience(self, snippets: List[str]) -> List[DueDiligenceFinding]:
        findings = []
        for text in snippets:
            lower = text.lower()
            unilateral = "company shall have no right" in lower or "sole convenience" in lower

            severity = RiskSeverity.HIGH if unilateral else RiskSeverity.MEDIUM
            analysis = (
                "Unilateral termination for convenience by counterparty on short notice (30 days). "
                "Presents revenue vulnerability post-acquisition: counterparty can walk away immediately upon learning of the deal."
            )
            action = (
                "Financial DD coordination: Assess customer concentration and valuation haircut if counterparty terminates; "
                "consider retention conversations as part of pre-closing integration."
            )

            findings.append(DueDiligenceFinding(
                category=ClauseCategory.TERMINATION_CONVENIENCE,
                severity=severity,
                consent_required=False,
                consent_standard=ConsentStandard.NOT_REQUIRED,
                verbatim_quote=text,
                legal_analysis=analysis,
                recommended_action=action
            ))
        return findings
