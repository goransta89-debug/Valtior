"""
Model Parser Service
--------------------
Converts raw model text into the structured JSON format defined in the blueprint.

Three validation layers (run in sequence by the background task):
  1. AI Parsing       — extracts structure from raw text (Claude API)
  2. Structural Checks — deterministic rule-based checks (always runs)
  3. AI Validation    — deep logic review using FFFS 2017:11 three-question framework

Regulatory basis embedded in this module:
  - FFFS 2017:11 §§14–17  (Finansinspektionen — model validation requirements)
  - PTL 6 kap. 1§          (Penningtvättslagen — risk-based approach mandate)
  - Prop. 2016/17:173      (Legislative basis for Swedish AML risk assessment)
  - FATF Recommendation 10 (Risk-based Customer Due Diligence)
  - SIMPT Vägledning Modellriskhantering (November 2024)
"""

import re
import hashlib
import json
import os
from typing import Optional
import anthropic


def hash_text(text: str) -> str:
    """SHA-256 hash of raw model text. Used for version deduplication."""
    return hashlib.sha256(text.encode()).hexdigest()


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1: AI Parsing
# ─────────────────────────────────────────────────────────────────────────────

def parse_model_with_ai(raw_text: str, model_name: str = "Unnamed Model", doc_type: str = "unknown") -> dict:
    """
    Send raw model text to Claude and extract the structured model representation.
    Returns the structured model JSON or raises on failure.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _placeholder_structure(raw_text, model_name)

    client = anthropic.Anthropic(api_key=api_key)

    # Tailor extraction strategy hint based on detected document type
    doc_type_hints = {
        "tabular": (
            "This document is primarily TABULAR (scoring matrices, Excel-style tables). "
            "Focus on reading [TABLE] blocks to extract factors, weights, scores, and bands. "
            "Column headers in tables usually indicate factor names or band labels. "
            "Row values are the scoring levels."
        ),
        "narrative": (
            "This document is primarily NARRATIVE (policy text, Word prose). "
            "Extract risk factors from descriptions like 'customers are scored based on...', "
            "'high risk indicators include...', 'the following factors are considered...'. "
            "Weights may be implicit (e.g. 'geography is the primary factor') — note this in parsing_notes."
        ),
        "hybrid": (
            "This document is HYBRID — it contains both prose explanations and tables. "
            "Use [TABLE] blocks for precise factor values and scores; use prose for rationale, "
            "assumptions, and context that tables do not capture."
        ),
    }
    doc_type_hint = doc_type_hints.get(doc_type, "Document type unknown — extract whatever structure is present.")

    json_schema = '''{
  "name": "model name",
  "risk_factors": [
    {
      "id": "rf_01",
      "name": "factor name",
      "category": "customer_profile | geography | product | channel | transaction | ownership | pep_sanctions",
      "values": [{"label": "value label", "score": 1}],
      "weight": 0.25,
      "mandatory": true,
      "rationale": "documented reason why this factor is included",
      "data_source": "where data for this factor comes from",
      "source_text": "relevant excerpt from source"
    }
  ],
  "scoring_logic": {
    "method": "weighted_sum",
    "max_score": 100,
    "formula": "description of how score is computed",
    "missing_data_handling": "what happens when a factor value is unknown"
  },
  "bands": [
    {"label": "Low", "min": 0, "max": 29, "action": "review frequency / action", "review_frequency": "e.g. 36 months"}
  ],
  "triggers": [
    {
      "id": "tr_01",
      "name": "trigger name",
      "condition": "plain-language condition",
      "override": "what risk level it overrides to",
      "independent_of_score": true,
      "regulatory_basis": "e.g. PTL 2 kap. 3 paragraph"
    }
  ],
  "outputs": {
    "primary": "risk_band",
    "secondary": ["computed_score"],
    "feeds_into": ["KYC workflow", "transaction monitoring threshold"]
  },
  "assumptions": [
    {"id": "a_01", "text": "assumption text", "sensitivity": "high | medium | low"}
  ],
  "metadata": {
    "model_owner": null,
    "approval_date": null,
    "next_review_date": null,
    "regulatory_references": [],
    "parsing_confidence": "high | medium | low",
    "parsing_notes": "any ambiguities or assumptions made during parsing"
  }
}'''

    system_prompt = (
        "You are a model parsing assistant for an AML/KYC model validation platform.\n"
        "Your job is to extract structured information from risk model descriptions and return ONLY valid JSON.\n\n"
        "DOCUMENT TYPE HINT: " + doc_type_hint + "\n\n"
        "IMPORTANT EXTRACTION RULES:\n"
        "- If the document is in Swedish, translate field values to English but preserve original terms in source_text\n"
        "- If a weight is not explicitly stated, make your best inference and note it in parsing_notes\n"
        "- If a table has a header row, use it to identify column meanings\n"
        "- [TABLE] blocks contain structured data — prioritise these over prose for numeric values\n"
        "- If you cannot determine a value, use null — never invent data\n"
        "- Capture partial information: a model with 3 of 6 factors extracted is more useful than none\n\n"
        "Extract the following structure:\n"
        + json_schema + "\n\n"
        "Key extraction rules:\n"
        "- If a PEP (Politically Exposed Person) factor or trigger exists, capture it with category 'pep_sanctions'\n"
        "- Extract any mention of sanctions screening, adverse media, or ownership structure\n"
        "- If weight rationale is given, capture it in the 'rationale' field\n"
        "- If data sources are mentioned (e.g. 'from onboarding form', 'from KYC system'), capture them\n"
        "- If a very high / highest risk band exists, capture it\n"
        "- If assumptions are stated, list them\n\n"
        "If information is missing, use null for optional fields and flag it in parsing_notes.\n"
        "Return ONLY the JSON object — no explanation, no markdown, no code blocks."
    )

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": f"Parse this risk model and return structured JSON:\n\n{raw_text}"
            }
        ],
        system=system_prompt
    )

    response_text = message.content[0].text.strip()

    if response_text.startswith("```"):
        response_text = re.sub(r"```(?:json)?\n?", "", response_text).strip().rstrip("```").strip()

    return json.loads(response_text)


def _placeholder_structure(raw_text: str, model_name: str) -> dict:
    """Returns a placeholder when no API key is configured."""
    return {
        "name": model_name,
        "risk_factors": [],
        "scoring_logic": {
            "method": "weighted_sum",
            "max_score": 100,
            "formula": "Configure ANTHROPIC_API_KEY to enable AI-assisted parsing",
            "missing_data_handling": None
        },
        "bands": [],
        "triggers": [],
        "assumptions": [],
        "outputs": {
            "primary": "risk_band",
            "secondary": ["computed_score"],
            "feeds_into": []
        },
        "metadata": {
            "model_owner": None,
            "approval_date": None,
            "next_review_date": None,
            "regulatory_references": [],
            "parsing_confidence": "none",
            "parsing_notes": "AI parsing requires ANTHROPIC_API_KEY. Raw text stored and ready to parse once key is configured."
        }
    }


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2: Structural Checks (deterministic — always runs)
# ─────────────────────────────────────────────────────────────────────────────

def run_structural_checks(structured: dict) -> list:
    """
    Deterministic rule-based checks. Fast, reliable, no API call needed.
    Regulatory references are from FFFS 2017:11, PTL, and FATF.
    Returns a list of finding dicts.
    """
    findings = []
    if not structured:
        return findings

    bands    = structured.get("bands", []) or []
    factors  = structured.get("risk_factors", []) or []
    triggers = structured.get("triggers", []) or []
    metadata = structured.get("metadata", {}) or {}
    assumptions = structured.get("assumptions", []) or []
    scoring  = structured.get("scoring_logic", {}) or {}

    # ── Check 1: Band continuity ──────────────────────────────────────────────
    if len(bands) >= 2:
        sorted_bands = sorted(bands, key=lambda b: b.get("min", 0))
        for i in range(len(sorted_bands) - 1):
            current_max = sorted_bands[i].get("max", -1)
            next_min    = sorted_bands[i + 1].get("min", -1)
            if current_max + 1 != next_min:
                findings.append({
                    "source": "structural_check",
                    "category": "logic_inconsistency",
                    "severity": "Critical",
                    "framework_dimension": "implementation_testning",
                    "title": f"Score gap between '{sorted_bands[i]['label']}' and '{sorted_bands[i+1]['label']}' bands",
                    "description": (
                        f"Scores between {current_max + 1} and {next_min - 1} are unclassified. "
                        f"Customers scoring in this range will not receive a risk band, making the model "
                        f"non-operational for those cases. Under FFFS 2017:11 §15, the model must produce "
                        f"a deterministic output for every possible input combination."
                    ),
                    "affected_elements": ["bands"],
                    "recommendation": (
                        "Adjust band boundaries so they are contiguous with no gaps. "
                        "Every integer score from 0 to max_score must map to exactly one band."
                    ),
                    "regulatory_reference": "FFFS 2017:11 §15 — model must be fit for purpose with complete output coverage; FATF Recommendation 10"
                })

    # ── Check 2: Band overlap ─────────────────────────────────────────────────
    if len(bands) >= 2:
        sorted_bands = sorted(bands, key=lambda b: b.get("min", 0))
        for i in range(len(sorted_bands) - 1):
            current_max = sorted_bands[i].get("max", -1)
            next_min    = sorted_bands[i + 1].get("min", -1)
            if current_max >= next_min:
                findings.append({
                    "source": "structural_check",
                    "category": "logic_inconsistency",
                    "severity": "Critical",
                    "framework_dimension": "implementation_testning",
                    "title": f"Band overlap between '{sorted_bands[i]['label']}' and '{sorted_bands[i+1]['label']}'",
                    "description": (
                        f"Scores {next_min}–{current_max} fall within two bands simultaneously. "
                        f"Overlapping bands make the model non-deterministic — the same score produces "
                        f"different classifications depending on processing order."
                    ),
                    "affected_elements": ["bands"],
                    "recommendation": "Ensure each band has a unique, non-overlapping score range.",
                    "regulatory_reference": "FFFS 2017:11 §15 — model must produce correct, deterministic outputs"
                })

    # ── Check 3: Missing Very High risk band ─────────────────────────────────
    band_labels = [b.get("label", "").lower() for b in bands]
    has_very_high = any("very high" in lbl or "mycket hög" in lbl or "very_high" in lbl for lbl in band_labels)
    if bands and not has_very_high:
        findings.append({
            "source": "structural_check",
            "category": "regulatory_gap",
            "severity": "High",
            "framework_dimension": "modellutformning",
            "title": "No 'Very High' risk band defined",
            "description": (
                "The model does not have a distinct Very High risk category. "
                "FI sanction decisions against Swedbank (2020), Trustly (2022), and Svea Bank (2024) "
                "all cited inadequate differentiation at the high end of the risk spectrum. "
                "Without a Very High band, high-risk customers — including certain PEPs and high-risk "
                "jurisdictions — cannot be escalated to the most intensive due diligence tier."
            ),
            "affected_elements": ["bands"],
            "recommendation": (
                "Add a 'Very High' band at the top of the scale (e.g. score 81–100) with corresponding "
                "actions: enhanced due diligence mandatory, senior compliance approval required, "
                "review frequency 6 months or less."
            ),
            "regulatory_reference": "FFFS 2017:11 §14 — risk-based approach; PTL 6 kap. 1§ — enhanced measures for high-risk"
        })

    # ── Check 4: Weight sum ───────────────────────────────────────────────────
    if factors:
        total_weight = sum(f.get("weight", 0) or 0 for f in factors)
        if total_weight > 0.01 and abs(total_weight - 1.0) > 0.02:
            findings.append({
                "source": "structural_check",
                "category": "logic_inconsistency",
                "severity": "High",
                "framework_dimension": "implementation_testning",
                "title": f"Risk factor weights sum to {total_weight:.2f}, not 1.00",
                "description": (
                    f"Factor weights must sum to 1.0 (100%) for the scoring formula to produce scores "
                    f"in the declared 0–{structured.get('scoring_logic', {}).get('max_score', 100)} range. "
                    f"Current total: {total_weight:.2f}. This means the actual score range differs from "
                    f"the documented range, making band thresholds incorrect."
                ),
                "affected_elements": ["risk_factors", "scoring_logic"],
                "recommendation": (
                    "Rebalance factor weights to sum to exactly 1.0. "
                    "Consider which factors are disproportionately over- or underweighted relative to "
                    "their regulatory and empirical importance."
                ),
                "regulatory_reference": "FFFS 2017:11 §15 — parameters and data must be correct and complete"
            })

    # ── Check 5: Single-value factors (no discriminatory power) ──────────────
    for f in factors:
        values = f.get("values", []) or []
        if len(values) <= 1:
            findings.append({
                "source": "structural_check",
                "category": "scoring_gap",
                "severity": "Medium",
                "framework_dimension": "modellutformning",
                "title": f"Factor '{f.get('name', 'Unknown')}' has only {len(values)} value — no discriminatory power",
                "description": (
                    f"A risk factor with only one possible value assigns every customer the same score "
                    f"for this dimension. It contributes weight but zero differentiation, effectively "
                    f"distorting the weighting of all other factors."
                ),
                "affected_elements": ["risk_factors"],
                "recommendation": (
                    "Define at least two distinct value levels with different scores. "
                    "If no meaningful differentiation is possible, remove the factor and redistribute its weight."
                ),
                "regulatory_reference": "FFFS 2017:11 §15 — model assumptions must be relevant and appropriate"
            })

    # ── Check 6: Missing geography factor ─────────────────────────────────────
    factor_categories = [f.get("category", "").lower() for f in factors]
    factor_names = [f.get("name", "").lower() for f in factors]
    geo_keywords = ["geograph", "country", "jurisdict", "location", "nation", "land"]
    has_geo = any(
        any(kw in cat for kw in geo_keywords) or any(kw in name for kw in geo_keywords)
        for cat, name in zip(factor_categories, factor_names)
    )
    if not has_geo and factors:
        findings.append({
            "source": "structural_check",
            "category": "regulatory_gap",
            "severity": "High",
            "framework_dimension": "modellutformning",
            "title": "No geographic risk factor in model",
            "description": (
                "No factor capturing customer country of residence, business jurisdiction, or "
                "transaction geography has been identified. Geographic risk is a mandatory dimension "
                "under both Swedish and EU AML regulation. Swedish sanctions against LF Bank (2023) "
                "and Svea Bank (2024) cited insufficient geographic risk assessment."
            ),
            "affected_elements": ["risk_factors"],
            "recommendation": (
                "Add a Geography factor with at minimum three levels: Standard jurisdiction (low score), "
                "EU/EEA with elevated monitoring (medium score), FATF grey/black list jurisdiction (high score). "
                "Reference FATF's current list of jurisdictions under increased monitoring."
            ),
            "regulatory_reference": "FFFS 2017:11 §14; PTL 2 kap. 8§; FATF Recommendation 10"
        })

    # ── Check 7: Missing PEP factor or trigger ────────────────────────────────
    pep_keywords = ["pep", "politically exposed", "politiskt exponerad"]
    has_pep_factor = any(
        any(kw in cat for kw in pep_keywords) or any(kw in name for kw in pep_keywords)
        for cat, name in zip(factor_categories, factor_names)
    )
    has_pep_trigger = any(
        any(kw in t.get("name", "").lower() or kw in t.get("condition", "").lower() for kw in pep_keywords)
        for t in triggers
    )
    if factors and not has_pep_factor and not has_pep_trigger:
        findings.append({
            "source": "structural_check",
            "category": "regulatory_gap",
            "severity": "Critical",
            "framework_dimension": "modellutformning",
            "title": "PEP (Politically Exposed Person) not addressed in model",
            "description": (
                "No factor or trigger for Politically Exposed Persons (PEPs) has been identified. "
                "PTL 2 kap. 3§ defines PEPs and requires enhanced due diligence for this customer category. "
                "FFFS 2017:11 explicitly names PEP status as a mandatory risk indicator. "
                "Failure to address PEPs is among the most frequently cited deficiencies in FI enforcement actions."
            ),
            "affected_elements": ["risk_factors", "triggers"],
            "recommendation": (
                "Add a PEP trigger that overrides the risk classification to at minimum High, "
                "and preferably Very High. PEP status should be independent of the computed score — "
                "a PEP customer scoring low on all other factors must still trigger enhanced due diligence."
            ),
            "regulatory_reference": "PTL 2 kap. 3§ — PEP definition; PTL 3 kap. 14§ — enhanced measures for PEPs; FFFS 2017:11 §14"
        })

    # ── Check 8: Missing sanctions trigger ────────────────────────────────────
    sanctions_keywords = ["sanction", "sanktions", "ofac", "eu sanction", "freeze", "embargo"]
    has_sanctions = any(
        any(kw in t.get("name", "").lower() or kw in t.get("condition", "").lower() for kw in sanctions_keywords)
        for t in triggers
    ) or any(
        any(kw in name for kw in sanctions_keywords) for name in factor_names
    )
    if factors and not has_sanctions:
        findings.append({
            "source": "structural_check",
            "category": "regulatory_gap",
            "severity": "High",
            "framework_dimension": "modellutformning",
            "title": "No sanctions screening trigger defined",
            "description": (
                "The model does not reference sanctions screening as a trigger or override condition. "
                "Sanctions screening is a legal requirement separate from AML risk rating — "
                "a customer on a sanctions list must be blocked regardless of their risk score. "
                "The model should reference how sanctions hits are handled."
            ),
            "affected_elements": ["triggers"],
            "recommendation": (
                "Add a Sanctions trigger: if customer, beneficial owner, or related party appears on "
                "EU, UN, or OFAC consolidated sanctions lists → immediate escalation, transaction blocking, "
                "and regulatory reporting. This operates independently of the risk score."
            ),
            "regulatory_reference": "EU Regulation 2580/2001; PTL 4 kap. — customer due diligence obligations"
        })

    # ── Check 9: Missing data source documentation ────────────────────────────
    factors_without_source = [
        f.get("name", "Unknown") for f in factors
        if not f.get("data_source") and not f.get("source_text")
    ]
    if len(factors_without_source) > len(factors) * 0.5 and factors:
        findings.append({
            "source": "structural_check",
            "category": "documentation_gap",
            "severity": "Medium",
            "framework_dimension": "data",
            "title": f"Data sources undocumented for {len(factors_without_source)} of {len(factors)} factors",
            "description": (
                f"The following factors have no documented data source: {', '.join(factors_without_source[:5])}. "
                f"FFFS 2017:11 §15 requires that the validator confirms data used in the model is correct "
                f"and complete — this is impossible without knowing where the data comes from."
            ),
            "affected_elements": ["risk_factors"],
            "recommendation": (
                "For each risk factor, document: (1) the system or process that provides the data, "
                "(2) data quality controls in place, (3) what happens when the data is unavailable. "
                "This is a prerequisite for validation sign-off."
            ),
            "regulatory_reference": "FFFS 2017:11 §15 — data must be correct and complete; SIMPT Vägledning 2024 §3.2"
        })

    # ── Check 10: Missing assumptions documentation ───────────────────────────
    if factors and len(assumptions) == 0:
        findings.append({
            "source": "structural_check",
            "category": "documentation_gap",
            "severity": "Medium",
            "framework_dimension": "modellutformning",
            "title": "No model assumptions documented",
            "description": (
                "No explicit assumptions have been identified in the model documentation. "
                "All models rest on assumptions — about customer behavior, data quality, "
                "regulatory interpretation — and these must be stated to enable meaningful validation. "
                "FFFS 2017:11 §15 requires the validator to assess whether assumptions are relevant and appropriate, "
                "which is impossible if assumptions are not declared."
            ),
            "affected_elements": ["assumptions"],
            "recommendation": (
                "Document at least: (1) assumed data quality and completeness for each factor, "
                "(2) how missing or conflicting data is resolved, "
                "(3) assumptions underlying weight assignments (e.g. 'geography is weighted 25% based on "
                "historical case analysis showing X% of SAR cases involved high-risk jurisdictions')."
            ),
            "regulatory_reference": "FFFS 2017:11 §15(3) — assumptions must be relevant and appropriate; SIMPT Vägledning 2024"
        })

    # ── Check 11: Missing model ownership metadata ────────────────────────────
    if not metadata.get("model_owner"):
        findings.append({
            "source": "structural_check",
            "category": "documentation_gap",
            "severity": "Low",
            "framework_dimension": "styrning_uppföljning",
            "title": "Model owner not documented",
            "description": (
                "No model owner is identified in the documentation. SIMPT's guidance on model risk management "
                "(November 2024) requires each model to have a named owner responsible for its ongoing accuracy "
                "and for initiating re-validation when material changes occur."
            ),
            "affected_elements": ["metadata"],
            "recommendation": (
                "Assign a named model owner (individual or team) and document them in the model register. "
                "The owner is responsible for: monitoring model performance, identifying material changes, "
                "and initiating re-validation. They should formally sign off on validation reports."
            ),
            "regulatory_reference": "SIMPT Vägledning Modellriskhantering 2024 — model register and ownership requirements"
        })

    # ── Check 12: Missing next review date ────────────────────────────────────
    if not metadata.get("next_review_date"):
        findings.append({
            "source": "structural_check",
            "category": "documentation_gap",
            "severity": "Low",
            "framework_dimension": "styrning_uppföljning",
            "title": "Next validation review date not defined",
            "description": (
                "The model has no documented next review date. Ongoing model validation is a regulatory "
                "requirement — models must be re-validated periodically and whenever material changes occur. "
                "Without a scheduled review date, the model risks becoming stale without triggering re-validation."
            ),
            "affected_elements": ["metadata"],
            "recommendation": (
                "Define a next review date — typically 12 months from initial validation for new models, "
                "or sooner if the model covers rapidly evolving risk areas (e.g. crypto, high-risk jurisdictions). "
                "Add this to the institution's model register."
            ),
            "regulatory_reference": "FFFS 2017:11 §17 — ongoing monitoring; SIMPT Vägledning 2024 — model lifecycle phase 7"
        })

    return findings


# ─────────────────────────────────────────────────────────────────────────────
# Layer 3: AI Validation (FFFS 2017:11 three-question framework)
# ─────────────────────────────────────────────────────────────────────────────

def validate_model_with_ai(structured: dict, raw_text: str) -> list:
    """
    Deep AI validation using the FFFS 2017:11 three mandatory validation questions.
    Returns a list of findings dicts.

    The three questions from FFFS 2017:11 §15:
      1. Är modellen ändamålsenlig?       (Is the model fit for purpose?)
      2. Är parametrar och data korrekta och fullständiga?  (Are parameters and data correct/complete?)
      3. Är antaganden relevanta och lämpliga?  (Are assumptions relevant and appropriate?)
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return []

    client = anthropic.Anthropic(api_key=api_key)

    model_json = json.dumps(structured, indent=2, ensure_ascii=False)

    system_prompt = """You are a senior AML/KYC model validator at a financial institution.
You apply the Swedish regulatory framework for model validation — specifically FFFS 2017:11 §15,
which requires validation to address three mandatory questions:

1. ÄNDAMÅLSENLIGHET (Fitness for Purpose)
   - Does the model clearly define its intended use and scope?
   - Does it cover all customer segments and product types in scope?
   - Is the risk appetite reflected in the band definitions and actions?
   - Does the model output connect to downstream processes (KYC workflow, TM thresholds, EDD triggers)?
   - Are there scenarios where the model produces a result that contradicts its stated purpose?

2. DATA OCH PARAMETRAR (Data and Parameters)
   - Are the risk factors appropriate for AML/KYC risk — i.e. do they capture what regulators expect?
   - Are weight assignments defensible given available empirical evidence or regulatory guidance?
   - Are scoring scales proportionate (i.e. is the score difference between Low and High meaningful)?
   - Is there evidence of missing risk dimensions given the institution's business model?
   - Are there factors that may introduce unintended bias or that contradict FATF guidance?

3. ANTAGANDEN (Assumptions)
   - Are any assumptions implicit but undocumented?
   - Are weight assignments treated as facts when they should be flagged as assumptions?
   - Does the model assume data quality that may not exist in practice?
   - Are trigger conditions based on assumptions that may not hold (e.g. assuming PEP screening is always current)?

For each significant issue found, return a finding in this exact JSON structure.
Return a JSON array of findings — nothing else:
[
  {
    "source": "validation_engine",
    "framework_dimension": "one of: modellutformning | data | implementation_testning | styrning_uppföljning",
    "category": "one of: logic_inconsistency | scoring_gap | regulatory_gap | documentation_gap | assumption_risk | coverage_gap",
    "severity": "one of: Critical | High | Medium | Low | Observation",
    "title": "short, specific title (max 15 words)",
    "description": "2–4 sentences explaining the specific problem and why it matters for AML/KYC compliance",
    "affected_elements": ["list of affected model elements"],
    "recommendation": "1–3 sentences with concrete corrective action",
    "regulatory_reference": "specific regulation or guidance (e.g. FFFS 2017:11 §15(2), PTL 2 kap. 3§)"
  }
]

Framework dimension guidance (Frank Penny / SIMPT kontrollramverk):
- modellutformning: Issues with model design, stated purpose, assumptions, logic construction, risk factor selection, whether the model is fit for its purpose
- data: Issues with data sources, data quality, completeness, documentation of where data comes from, mapping and transformations
- implementation_testning: Issues with how the model is implemented — scoring arithmetic, band thresholds, trigger logic, whether implementation matches documented design
- styrning_uppföljning: Issues with governance — model ownership, roles and responsibilities, change management, documentation completeness, review schedules, audit trail

Severity guidance:
- Critical: Model cannot be used for its stated purpose; regulatory breach likely
- High: Significant gap that must be resolved before sign-off
- Medium: Gap that reduces model quality; should be resolved or formally accepted with rationale
- Low: Minor weakness or improvement opportunity
- Observation: Notable point for the validation record; no action required

Be specific and practical. Reference exact factor names, band labels, or trigger names when discussing issues.
Do not repeat findings that would be caught by deterministic structural checks (band gaps, weight sums, etc).
Focus on logical, conceptual, and regulatory issues that require expert judgment.
Return an empty array [] if the model is well-constructed and no significant issues are found.
Return ONLY the JSON array — no explanation, no markdown."""

    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Validate this AML/KYC risk model using the FFFS 2017:11 three-question framework.\n\n"
                    f"PARSED MODEL STRUCTURE:\n{model_json}\n\n"
                    f"ORIGINAL MODEL TEXT (for context):\n{raw_text[:3000]}"
                )
            }
        ],
        system=system_prompt
    )

    response_text = message.content[0].text.strip()

    if response_text.startswith("```"):
        response_text = re.sub(r"```(?:json)?\n?", "", response_text).strip().rstrip("```").strip()

    findings = json.loads(response_text)

    # Validate each finding has required fields
    required_keys = {"source", "category", "severity", "title", "description", "recommendation"}
    valid_dimensions = {"modellutformning", "data", "implementation_testning", "styrning_uppföljning"}
    valid_findings = []
    for f in findings:
        if isinstance(f, dict) and required_keys.issubset(f.keys()):
            f.setdefault("affected_elements", [])
            f.setdefault("regulatory_reference", None)
            f["source"] = "validation_engine"  # enforce correct source tag
            # Validate framework_dimension — default to modellutformning if missing/invalid
            if f.get("framework_dimension") not in valid_dimensions:
                f["framework_dimension"] = "modellutformning"
            valid_findings.append(f)

    return valid_findings
