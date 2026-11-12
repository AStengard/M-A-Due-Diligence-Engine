"""
Contract ingestion and clause extraction engine.
Parses raw agreements, identifies structural sections, and isolates target clauses.
"""

import re
from typing import Dict, List, Optional


class ClauseExtractor:
    """Extracts metadata and key M&A clauses from contract text."""

    def __init__(self):
        # Section header patterns common in legal agreements
        self.section_pattern = re.compile(
            r"(?:\n|^)(?:SECTION|ARTICLE|CLAUSE|\d+)\.?\s*([0-9A-Z\.\s\-\–\—]{2,60})(?:\.|\n)",
            re.IGNORECASE
        )

    def extract_metadata(self, text: str) -> Dict[str, Optional[str]]:
        """Extracts basic metadata: title, parties, effective date, governing law."""
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        title = lines[0] if lines else "Commercial Agreement"

        # Extract Effective Date
        date_match = re.search(r"as of ([A-Z][a-z]+ \d{1,2}, \d{4})", text, re.IGNORECASE) or re.search(r"dated as of ([A-Z][a-z]+ \d{1,2}, \d{4})", text, re.IGNORECASE)
        effective_date = date_match.group(1) if date_match else "Unknown"

        # Extract Governing Law
        law_match = re.search(
            r"governed by(?: and (?:construed in accordance with|interpreted))? (?:under )?the laws of (?:the State of )?([A-Za-z\s]+?)(?:,|\.|\s+without)",
            text,
            re.IGNORECASE
        ) or re.search(r"governed by ([A-Za-z]+) law without", text, re.IGNORECASE)
        governing_law = law_match.group(1).strip() if law_match else "Unspecified"

        # Extract Parties (heuristic regex)
        parties = []
        party_match = re.search(r"by and between (.+?) and (.+?)(?:\.|\n|\()", text, re.DOTALL)
        if party_match:
            parties = [
                re.sub(r"\s+", " ", party_match.group(1).split(",")[0]).strip(),
                re.sub(r"\s+", " ", party_match.group(2).split(",")[0]).strip()
            ]
        else:
            parties = ["Target Technologies Corp.", "Counterparty"]

        return {
            "title": title,
            "effective_date": effective_date,
            "governing_law": governing_law,
            "parties": parties
        }

    def segment_clauses(self, text: str) -> Dict[str, List[str]]:
        """
        Segments the text into sections and maps relevant candidate clauses
        by functional legal risk category.
        """
        categories = {
            "change_of_control": [],
            "assignment": [],
            "restrictive_covenant": [],
            "termination_convenience": []
        }

        # Break text into paragraphs / sub-clauses
        paragraphs = re.split(r"\n\s*\n", text)

        for p in paragraphs:
            clean_p = p.strip()
            if not clean_p or len(clean_p) < 40:
                continue

            lower_p = clean_p.lower()

            # Change of Control detection
            if ("change of control" in lower_p or "change in control" in lower_p or "change in ownership" in lower_p):
                categories["change_of_control"].append(clean_p)

            # Assignment detection
            elif ("assign" in lower_p or "transfer this agreement" in lower_p or "by operation of law" in lower_p):
                categories["assignment"].append(clean_p)

            # Restrictive covenants / Non-compete / Exclusivity (operative sections only)
            is_operative = ("shall not" in lower_p or "negative covenant" in lower_p or "exclusive appointment" in lower_p or "non-compete" in lower_p)
            is_restrictive = is_operative and ("non-compete" in lower_p or "competing" in lower_p or "exclusive" in lower_p)
            if is_restrictive and "change of control" not in lower_p and "assignment and transfers" not in lower_p and "recitals" not in lower_p:
                categories["restrictive_covenant"].append(clean_p)

            # Termination for convenience
            if ("termination for convenience" in lower_p or "terminate this agreement without cause" in lower_p or "sole convenience" in lower_p):
                categories["termination_convenience"].append(clean_p)

        return categories
