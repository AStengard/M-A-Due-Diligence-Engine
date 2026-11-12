"""
Data models and schemas for M&A Legal Due Diligence Contract Extraction.
"""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class RiskSeverity(str, Enum):
    CRITICAL = "CRITICAL"      # Deal blocker, Buyer business contamination, immediate termination right
    HIGH = "HIGH"              # Prior consent required with sole discretion or steep clawback
    MEDIUM = "MEDIUM"          # Consent required but not to be unreasonably withheld; ambiguity on stock vs asset
    LOW = "LOW"                # Permitted transfer carve-out, standard post-closing notice only
    INFORMATIONAL = "INFO"     # Standard terms with no deal impact


class ClauseCategory(str, Enum):
    CHANGE_OF_CONTROL = "Change of Control (CoC)"
    ASSIGNMENT = "Assignment & Transfer"
    RESTRICTIVE_COVENANT = "Restrictive Covenant / Non-Compete"
    TERMINATION_CONVENIENCE = "Termination for Convenience"
    OTHER = "Other Material Clause"


class ConsentStandard(str, Enum):
    SOLE_DISCRETION = "Sole and Absolute Discretion"
    REASONABLE = "Not Unreasonably Withheld/Delayed"
    SILENT = "Silent / Unspecified"
    NOT_REQUIRED = "Consent Not Required"


class DueDiligenceFinding(BaseModel):
    category: ClauseCategory
    severity: RiskSeverity
    consent_required: bool
    consent_standard: ConsentStandard
    notice_period_days: Optional[int] = None
    termination_risk_on_closing: bool = False
    affiliate_contamination_risk: bool = False
    verbatim_quote: str = Field(..., description="Exact clause excerpt from the contract")
    legal_analysis: str = Field(..., description="Why this matters in an M&A transaction")
    recommended_action: str = Field(..., description="E.g., Condition Precedent, Disclosure Schedule, Waiver")


class ContractAnalysisResult(BaseModel):
    file_name: str
    contract_title: str
    parties: List[str]
    effective_date: Optional[str] = None
    governing_law: Optional[str] = None
    findings: List[DueDiligenceFinding]
    overall_contract_risk: RiskSeverity
    closing_condition_precedent_required: bool
    disclosure_schedule_required: bool


class DueDiligenceReport(BaseModel):
    deal_name: str
    target_company: str
    contracts_analyzed: int
    critical_risks_count: int
    high_risks_count: int
    medium_risks_count: int
    low_risks_count: int
    results: List[ContractAnalysisResult]
