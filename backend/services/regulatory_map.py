"""
Swedish AML Regulatory Compliance Mapping
------------------------------------------
Maps each Swedish law requirement to a model check.

Primary sources:
  PTL   — Penningtvättslagen (2017:630)
  FFFS  — Finansinspektionens föreskrifter 2017:11
  Prop  — Prop. 2016/17:173 (legislative basis)
  FATF  — FATF Recommendations (incorporated into Swedish law via FFFS)
  SIMPT — SIMPT Vägledning Modellriskhantering (November 2024)

Each requirement has a compliance_check function that returns:
  "MET"      — model clearly meets this requirement
  "PARTIAL"  — model partially meets this requirement
  "NOT_MET"  — model clearly does not meet this requirement
  "UNCLEAR"  — cannot determine from available information
"""


REQUIREMENTS = [
    {
        "id": "REQ-001",
        "law": "PTL 6 kap. 1§",
        "short": "Risk-based approach",
        "description": (
            "The institution must conduct a risk assessment for each customer "
            "and apply measures proportionate to that risk."
        ),
        "what_model_must_do": "Produce a risk classification for every customer based on defined factors.",
        "check_key": "has_risk_factors",
    },
    {
        "id": "REQ-002",
        "law": "FFFS 2017:11 §14",
        "short": "Geographic risk factor",
        "description": (
            "Geographic risk — specifically the customer's country of residence or "
            "business operations — must be assessed."
        ),
        "what_model_must_do": "Include a geographic risk factor with country or jurisdiction scoring.",
        "check_key": "has_geography",
    },
    {
        "id": "REQ-003",
        "law": "PTL 2 kap. 3§ + 3 kap. 14§",
        "short": "PEP identification & EDD",
        "description": (
            "Politically Exposed Persons must be identified. Enhanced due diligence "
            "is mandatory for PEPs regardless of other risk factors."
        ),
        "what_model_must_do": "Identify PEPs and trigger enhanced due diligence, independent of computed score.",
        "check_key": "has_pep",
    },
    {
        "id": "REQ-004",
        "law": "EU Reg. 2580/2001 + PTL 4 kap.",
        "short": "Sanctions screening",
        "description": (
            "Transactions with sanctioned individuals, entities, or countries must be "
            "blocked. Sanctions screening is a separate legal obligation from risk scoring."
        ),
        "what_model_must_do": "Reference sanctions screening as a trigger independent of risk score.",
        "check_key": "has_sanctions",
    },
    {
        "id": "REQ-005",
        "law": "FFFS 2017:11 §15(1)",
        "short": "Ändamålsenlighet (fitness for purpose)",
        "description": (
            "The model must be fit for its stated purpose — it must produce a result "
            "for every customer and that result must connect to downstream CDD actions."
        ),
        "what_model_must_do": "Defined bands with associated CDD actions covering the full score range.",
        "check_key": "has_complete_bands",
    },
    {
        "id": "REQ-006",
        "law": "FFFS 2017:11 §15(2)",
        "short": "Data correctness & completeness",
        "description": (
            "Parameters and data used in the model must be correct and complete. "
            "The validator must be able to confirm the data sources."
        ),
        "what_model_must_do": "Document data sources for each risk factor.",
        "check_key": "has_data_sources",
    },
    {
        "id": "REQ-007",
        "law": "FFFS 2017:11 §15(3)",
        "short": "Assumptions (antaganden)",
        "description": (
            "Model assumptions must be relevant and appropriate. The validator "
            "must assess whether assumptions hold in the institution's operational context."
        ),
        "what_model_must_do": "Explicit documentation of model assumptions.",
        "check_key": "has_assumptions",
    },
    {
        "id": "REQ-008",
        "law": "PTL 4 kap. 1§",
        "short": "CDD tiering (simplified / standard / enhanced)",
        "description": (
            "The model must support three levels of customer due diligence: "
            "simplified (low risk), standard, and enhanced (high risk)."
        ),
        "what_model_must_do": "At least three distinct risk bands with differentiated CDD actions.",
        "check_key": "has_three_bands",
    },
    {
        "id": "REQ-009",
        "law": "FFFS 2017:11 §14",
        "short": "Very High / highest risk category",
        "description": (
            "The model should have a distinct highest risk category for customers requiring "
            "the most intensive measures (e.g. high-risk PEPs, FATF grey-list jurisdictions). "
            "FI enforcement actions against Swedbank and Svea Bank cited absent differentiation at top."
        ),
        "what_model_must_do": "A 'Very High' or equivalent band at the top of the scale.",
        "check_key": "has_very_high_band",
    },
    {
        "id": "REQ-010",
        "law": "FFFS 2017:11 §17",
        "short": "Ongoing validation schedule",
        "description": (
            "Models must be re-validated periodically and when material changes occur. "
            "A scheduled review date must be defined."
        ),
        "what_model_must_do": "Document next review date and trigger conditions for re-validation.",
        "check_key": "has_review_date",
    },
    {
        "id": "REQ-011",
        "law": "SIMPT Vägledning 2024",
        "short": "Model ownership",
        "description": (
            "Each model must have a named owner responsible for ongoing accuracy, "
            "performance monitoring, and initiating re-validation when needed."
        ),
        "what_model_must_do": "Named model owner documented.",
        "check_key": "has_model_owner",
    },
    {
        "id": "REQ-012",
        "law": "PTL 2 kap. 8§ + FFFS 2017:11 §14",
        "short": "Business relationship purpose",
        "description": (
            "The purpose and nature of the customer relationship must be assessed "
            "as part of customer due diligence — typically via product/service risk factors."
        ),
        "what_model_must_do": "Include product or service type as a risk factor.",
        "check_key": "has_product_factor",
    },
]


def assess_compliance(structured: dict, findings: list) -> list:
    """
    Assess model compliance against each Swedish regulatory requirement.

    Args:
        structured: parsed model JSON dict
        findings:   list of Finding ORM objects (or dicts with same fields)

    Returns:
        list of dicts with id, law, short, description, what_model_must_do, status, evidence
    """
    if not structured:
        return [
            {**r, "status": "UNCLEAR", "evidence": "Model has not been parsed yet."}
            for r in REQUIREMENTS
        ]

    factors   = structured.get("risk_factors", []) or []
    bands     = structured.get("bands", []) or []
    triggers  = structured.get("triggers", []) or []
    assumptions = structured.get("assumptions", []) or []
    metadata  = structured.get("metadata", {}) or {}

    factor_names = [f.get("name", "").lower() for f in factors]
    factor_cats  = [f.get("category", "").lower() for f in factors]

    # Build a set of finding categories that were flagged
    flagged_categories = set()
    for f in findings:
        cat = f.get("category") if isinstance(f, dict) else getattr(f, "category", "")
        if cat:
            flagged_categories.add(cat)

    def finding_titles() -> list:
        return [
            (f.get("title") if isinstance(f, dict) else getattr(f, "title", ""))
            for f in findings
        ]

    def has_keyword_in(keywords, collection):
        return any(any(kw in item for kw in keywords) for item in collection)

    checks = {}

    # REQ-001: has risk factors at all
    checks["has_risk_factors"] = (
        "MET" if len(factors) >= 2
        else "PARTIAL" if len(factors) == 1
        else "NOT_MET"
    )

    # REQ-002: geography factor
    geo_kw = ["geograph", "country", "jurisdict", "location", "nation", "land"]
    has_geo = has_keyword_in(geo_kw, factor_names) or has_keyword_in(geo_kw, factor_cats)
    checks["has_geography"] = "MET" if has_geo else "NOT_MET"

    # REQ-003: PEP
    pep_kw = ["pep", "politically exposed", "politiskt"]
    has_pep_factor = has_keyword_in(pep_kw, factor_names) or has_keyword_in(pep_kw, factor_cats)
    has_pep_trigger = any(
        any(kw in (t.get("name","") + t.get("condition","")).lower() for kw in pep_kw)
        for t in triggers
    )
    checks["has_pep"] = (
        "MET" if has_pep_trigger
        else "PARTIAL" if has_pep_factor
        else "NOT_MET"
    )

    # REQ-004: sanctions
    sanc_kw = ["sanction", "sanktions", "ofac", "embargo", "freeze"]
    has_sanc = has_keyword_in(sanc_kw, factor_names) or any(
        any(kw in (t.get("name","") + t.get("condition","")).lower() for kw in sanc_kw)
        for t in triggers
    )
    checks["has_sanctions"] = "MET" if has_sanc else "NOT_MET"

    # REQ-005: complete bands with actions
    bands_with_actions = [b for b in bands if b.get("action")]
    checks["has_complete_bands"] = (
        "MET" if len(bands) >= 3 and len(bands_with_actions) >= len(bands) * 0.7
        else "PARTIAL" if len(bands) >= 2
        else "NOT_MET"
    )

    # REQ-006: data sources
    factors_with_source = [f for f in factors if f.get("data_source") or f.get("source_text")]
    ratio = len(factors_with_source) / len(factors) if factors else 0
    checks["has_data_sources"] = (
        "MET" if ratio >= 0.8
        else "PARTIAL" if ratio >= 0.4
        else "NOT_MET"
    )

    # REQ-007: assumptions
    checks["has_assumptions"] = (
        "MET" if len(assumptions) >= 2
        else "PARTIAL" if len(assumptions) == 1
        else "NOT_MET"
    )

    # REQ-008: 3+ bands
    checks["has_three_bands"] = (
        "MET" if len(bands) >= 3
        else "PARTIAL" if len(bands) == 2
        else "NOT_MET"
    )

    # REQ-009: very high band
    band_labels_lower = [b.get("label","").lower() for b in bands]
    has_vh = any("very high" in lbl or "mycket hög" in lbl or "very_high" in lbl for lbl in band_labels_lower)
    checks["has_very_high_band"] = "MET" if has_vh else "NOT_MET"

    # REQ-010: review date
    checks["has_review_date"] = (
        "MET" if metadata.get("next_review_date")
        else "NOT_MET"
    )

    # REQ-011: model owner
    checks["has_model_owner"] = (
        "MET" if metadata.get("model_owner")
        else "NOT_MET"
    )

    # REQ-012: product/service factor
    prod_kw = ["product", "service", "account", "channel", "produkt", "tjänst"]
    has_product = has_keyword_in(prod_kw, factor_names) or has_keyword_in(prod_kw, factor_cats)
    checks["has_product_factor"] = "MET" if has_product else "NOT_MET" if factors else "UNCLEAR"

    # Assemble results
    status_notes = {
        "MET": "Requirement addressed in model.",
        "PARTIAL": "Requirement partially addressed — see findings for gaps.",
        "NOT_MET": "Requirement not addressed — remediation required.",
        "UNCLEAR": "Cannot determine from available model documentation.",
    }

    results = []
    for req in REQUIREMENTS:
        status = checks.get(req["check_key"], "UNCLEAR")
        results.append({
            **req,
            "status": status,
            "evidence": status_notes[status],
        })

    return results


def compliance_summary(compliance_results: list) -> dict:
    """Return counts and overall RAG status."""
    counts = {"MET": 0, "PARTIAL": 0, "NOT_MET": 0, "UNCLEAR": 0}
    for r in compliance_results:
        counts[r["status"]] += 1

    total = len(compliance_results)
    met_pct = round((counts["MET"] / total) * 100) if total else 0

    if counts["NOT_MET"] >= 3 or met_pct < 50:
        rag = "RED"
        rag_label = "Significant gaps — validation cannot be signed off"
    elif counts["NOT_MET"] >= 1 or counts["PARTIAL"] >= 3:
        rag = "AMBER"
        rag_label = "Gaps present — remediation required before sign-off"
    else:
        rag = "GREEN"
        rag_label = "Model addresses core regulatory requirements"

    return {
        "rag": rag,
        "rag_label": rag_label,
        "met_pct": met_pct,
        "counts": counts,
        "total": total,
    }
