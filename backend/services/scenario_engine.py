"""
Scenario Engine Service
-----------------------
Three modes:
  1. AI Generation  — Claude reads parsed model and auto-generates edge-case scenarios
  2. Manual Run     — user-defined input profile scored against the model
  3. Regulatory Library — pre-built templates based on FATF typologies & FFFS 2017:11
"""

import os
import json
from typing import Optional
import anthropic


# ─────────────────────────────────────────────────────────────────────────────
# Regulatory Library — pre-built scenario templates
# Based on FATF Recommendations, FFFS 2017:11, and common AML typologies
# ─────────────────────────────────────────────────────────────────────────────

REGULATORY_LIBRARY = [
    {
        "id": "LIB-001",
        "name": "PEP — Domestic, Active Public Function",
        "description": "Politically Exposed Person with current public role. FFFS 2017:11 §15 — mandatory EDD trigger.",
        "regulatory_basis": "FFFS 2017:11 §15 · PTL 1 kap. 8§ · FATF R.12",
        "input_profile": {
            "customer_type": "PEP",
            "geography": "Sweden (domestic)",
            "transaction_volume": "Medium",
            "product_type": "Private Banking",
            "business_relationship_duration": "New (<1 year)",
        },
        "expected_band": "High or Very High",
        "test_purpose": "Verify PEP triggers EDD and is not allowed to reach Low/Medium band.",
    },
    {
        "id": "LIB-002",
        "name": "Shell Company — High-Risk Jurisdiction",
        "description": "Corporate customer with complex ownership structure incorporated in a high-risk country.",
        "regulatory_basis": "FATF R.24 · PTL 3 kap. 14§ · FFFS 2017:11 §14",
        "input_profile": {
            "customer_type": "Corporate",
            "geography": "High-risk jurisdiction (FATF grey list)",
            "ownership_structure": "Complex / Layered",
            "transaction_volume": "High",
            "product_type": "Wire Transfers",
        },
        "expected_band": "High or Very High",
        "test_purpose": "Verify complex ownership + high-risk geography stacks to top band.",
    },
    {
        "id": "LIB-003",
        "name": "Cash-Intensive Business — Domestic",
        "description": "Retail business with predominantly cash turnover. Common ML typology.",
        "regulatory_basis": "FATF R.10 · PTL 2 kap. 3§",
        "input_profile": {
            "customer_type": "Corporate",
            "geography": "Sweden (domestic)",
            "business_type": "Cash-intensive retail",
            "transaction_volume": "High",
            "product_type": "Current Account",
        },
        "expected_band": "Medium or High",
        "test_purpose": "Verify cash-intensive business is not classified as Low risk.",
    },
    {
        "id": "LIB-004",
        "name": "Sanctions-Adjacent — Name Match",
        "description": "Customer name partially matches a sanctions list entry. Tests whether sanctions screening overrides score.",
        "regulatory_basis": "EU Regulation 2580/2001 · PTL 6 kap. 4§",
        "input_profile": {
            "customer_type": "Individual",
            "geography": "Middle East",
            "sanctions_hit": "Partial name match",
            "transaction_volume": "Low",
            "product_type": "Current Account",
        },
        "expected_band": "Very High (override)",
        "test_purpose": "Verify sanctions hit triggers mandatory escalation regardless of other factor scores.",
    },
    {
        "id": "LIB-005",
        "name": "Ordinary Retail Customer — Baseline",
        "description": "Low-risk individual with standard domestic profile. Tests that model does not over-classify.",
        "regulatory_basis": "PTL 6 kap. 1§ — proportionality principle",
        "input_profile": {
            "customer_type": "Individual",
            "geography": "Sweden (domestic)",
            "transaction_volume": "Low",
            "product_type": "Savings Account",
            "business_relationship_duration": "Established (>3 years)",
        },
        "expected_band": "Low",
        "test_purpose": "Verify a standard low-risk customer is correctly classified as Low — checks for over-classification.",
    },
    {
        "id": "LIB-006",
        "name": "Non-Resident — EU Passport, High Transactions",
        "description": "EU citizen residing abroad with high transaction volumes. Tests cross-border risk elevation.",
        "regulatory_basis": "FFFS 2017:11 §14 · FATF R.10",
        "input_profile": {
            "customer_type": "Individual",
            "geography": "EU (non-domestic)",
            "transaction_volume": "High",
            "product_type": "Wire Transfers",
            "residency": "Non-resident",
        },
        "expected_band": "Medium or High",
        "test_purpose": "Verify non-residency + high transactions elevates classification beyond Low.",
    },
    {
        "id": "LIB-007",
        "name": "NGO — Operates in Conflict Regions",
        "description": "Non-profit organization that transfers funds to high-risk geographies. FATF typology for NPO abuse.",
        "regulatory_basis": "FATF R.8 · PTL 2 kap. 3§",
        "input_profile": {
            "customer_type": "Non-profit / NGO",
            "geography": "Conflict zone (third-country)",
            "transaction_volume": "High",
            "product_type": "Wire Transfers",
        },
        "expected_band": "High or Very High",
        "test_purpose": "Verify NGO with conflict-zone transfers is not classified as Low/Medium.",
    },
    {
        "id": "LIB-008",
        "name": "Correspondent Bank — Non-EU",
        "description": "Correspondent banking relationship with a bank in a non-EU jurisdiction. FFFS 2017:11 enhanced due diligence.",
        "regulatory_basis": "FFFS 2017:11 §16 · PTL 3 kap. 16§ · FATF R.13",
        "input_profile": {
            "customer_type": "Financial Institution",
            "geography": "High-risk jurisdiction (FATF grey list)",
            "relationship_type": "Correspondent Banking",
            "transaction_volume": "Very High",
        },
        "expected_band": "Very High",
        "test_purpose": "Verify correspondent banking with non-EU high-risk bank triggers Very High + EDD.",
    },
]


# ─────────────────────────────────────────────────────────────────────────────
# 1. AI Scenario Generation
# ─────────────────────────────────────────────────────────────────────────────

def generate_scenarios_ai(structured: dict, raw_text: str) -> list:
    """
    Use Claude to generate 10 edge-case test scenarios based on the parsed model.

    Targets:
    - Boundary conditions (scores just above/below band cutoffs)
    - Regulatory mandatory cases (PEP, sanctions, high-risk geography)
    - Contradictory signal profiles (e.g. high geography + minimal transactions)
    - Missing factor combinations not covered by the model
    - Over-/under-classification risks
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return _placeholder_scenarios(structured)

    client = anthropic.Anthropic(api_key=api_key)

    model_summary = json.dumps(structured, indent=2)[:6000]  # Trim to avoid token limits

    prompt = (
        "You are a senior AML model validator with deep expertise in FATF Recommendations, "
        "Swedish PTL (2017:630), and FFFS 2017:11.\n\n"
        "You are given a structured AML/KYC customer risk model. "
        "Your task is to generate exactly 10 test scenarios that will stress-test this model.\n\n"
        "Focus on:\n"
        "1. Boundary conditions — customer profiles that score just at the edge of band transitions\n"
        "2. Regulatory mandatory cases — PEP, sanctions-adjacent, high-risk geographies\n"
        "3. Contradictory profiles — high risk in one factor offset by low risk in another (does weighting work?)\n"
        "4. Override triggers — cases where manual triggers should fire regardless of score\n"
        "5. Over-classification risk — very ordinary profiles that might score too high\n"
        "6. Under-classification risk — clearly high-risk profiles that could slip to Medium\n\n"
        "Return ONLY valid JSON — an array of 10 scenario objects. Each object must have:\n"
        '  "name": string (short, descriptive, e.g. "PEP — Domestic, Low Transactions")\n'
        '  "description": string (1-2 sentences explaining the test purpose)\n'
        '  "input_profile": object (key-value pairs of factor name → selected value label)\n'
        '  "expected_band": string (what band this profile SHOULD be classified as)\n'
        '  "test_purpose": string (what risk or gap this scenario specifically probes)\n'
        '  "regulatory_basis": string (relevant law/recommendation if applicable, or "")\n\n'
        "Use the actual risk factor names and value labels from the model below. "
        "If a factor is not relevant to a scenario, omit it from input_profile.\n\n"
        "MODEL STRUCTURE:\n"
        + model_summary
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        scenarios = json.loads(raw.strip())
        if isinstance(scenarios, list):
            return scenarios[:12]  # Cap at 12
        return _placeholder_scenarios(structured)
    except Exception as e:
        print(f"[Valtior] Scenario generation failed: {e}")
        return _placeholder_scenarios(structured)


def _placeholder_scenarios(structured: dict) -> list:
    """Fallback when no API key is set."""
    factors = structured.get("risk_factors", [])
    factor_names = [f.get("name", "Factor") for f in factors[:3]]
    return [
        {
            "name": "API Key Required",
            "description": "AI scenario generation requires an Anthropic API key. Configure it in Admin → Settings.",
            "input_profile": {f: "—" for f in factor_names},
            "expected_band": "—",
            "test_purpose": "Configure your API key in Admin → Settings, then regenerate.",
            "regulatory_basis": "",
        }
    ]


# ─────────────────────────────────────────────────────────────────────────────
# 2. Run a Scenario (score + AI assessment)
# ─────────────────────────────────────────────────────────────────────────────

def run_scenario(input_profile: dict, structured: dict, scenario_name: str) -> dict:
    """
    Given an input profile (factor → selected value) and the parsed model,
    compute a score, determine the band, check triggers, and get an AI assessment.

    Returns:
      computed_score: float | None
      assigned_band: str | None
      triggered_rules: list[str]
      ai_assessment: str
      flagged_issues: list[str]
    """
    risk_factors = structured.get("risk_factors", [])
    bands = structured.get("bands", [])
    triggers = structured.get("triggers", [])

    # ── Step 1: Compute weighted score ────────────────────────────────────────
    total_weight = 0.0
    weighted_sum = 0.0
    factor_details = []

    for factor in risk_factors:
        fname = factor.get("name", "")
        weight_raw = factor.get("weight", 0)

        # Normalize weight — could be "25%" or 0.25 or 25
        try:
            if isinstance(weight_raw, str):
                weight = float(weight_raw.strip("%")) / 100
            elif weight_raw > 1:
                weight = weight_raw / 100
            else:
                weight = float(weight_raw)
        except (ValueError, TypeError):
            weight = 0.0

        # Find the selected value for this factor
        selected_label = None
        for key in input_profile:
            if key.lower() in fname.lower() or fname.lower() in key.lower():
                selected_label = input_profile[key]
                break

        if selected_label is None:
            continue

        # Find the score for this selected value
        value_score = None
        value_labels = factor.get("value_labels", [])
        for vl in value_labels:
            vl_label = str(vl.get("label", "")).lower()
            if vl_label in str(selected_label).lower() or str(selected_label).lower() in vl_label:
                try:
                    value_score = float(vl.get("score", 0))
                except (ValueError, TypeError):
                    value_score = 0.0
                break

        if value_score is None:
            # Can't find a match — use midpoint if we know the range
            value_score = 2.5  # Default mid-score

        total_weight += weight
        weighted_sum += weight * value_score

        factor_details.append({
            "factor": fname,
            "selected": selected_label,
            "score": value_score,
            "weight": weight,
            "contribution": round(weight * value_score, 3),
        })

    # Normalize score to 0-100 range if possible
    scoring_info = structured.get("scoring", {})
    score_max = scoring_info.get("score_range", {}).get("max", 5)
    if not score_max:
        score_max = 5

    if total_weight > 0:
        raw_score = weighted_sum / total_weight
        # Normalize to 0-100
        computed_score = round((raw_score / score_max) * 100, 1)
    else:
        computed_score = None

    # ── Step 2: Assign band ───────────────────────────────────────────────────
    assigned_band = None
    if computed_score is not None and bands:
        for band in bands:
            b_min = band.get("min_score", 0)
            b_max = band.get("max_score", 100)
            try:
                if float(b_min) <= computed_score <= float(b_max):
                    assigned_band = band.get("name")
                    break
            except (ValueError, TypeError):
                continue

    # ── Step 3: Check triggers ────────────────────────────────────────────────
    triggered_rules = []
    for trigger in triggers:
        t_name = trigger.get("name", "")
        t_condition = str(trigger.get("condition", "")).lower()
        t_action = trigger.get("action", "")

        # Check if any input profile value matches this trigger's condition
        for key, val in input_profile.items():
            val_lower = str(val).lower()
            if any(kw in t_condition for kw in [val_lower, key.lower()]):
                triggered_rules.append(f"{t_name}: {t_action}")
                # If trigger overrides band, update assigned_band
                if "very high" in str(t_action).lower() or "override" in str(t_action).lower():
                    assigned_band = "Very High"
                break

    # ── Step 4: AI Assessment ─────────────────────────────────────────────────
    ai_assessment, flagged_issues = _ai_assess_scenario(
        scenario_name=scenario_name,
        input_profile=input_profile,
        computed_score=computed_score,
        assigned_band=assigned_band,
        triggered_rules=triggered_rules,
        factor_details=factor_details,
        structured=structured,
    )

    return {
        "computed_score": computed_score,
        "assigned_band": assigned_band,
        "triggered_rules": triggered_rules,
        "ai_assessment": ai_assessment,
        "flagged_issues": flagged_issues,
    }


def _ai_assess_scenario(
    scenario_name: str,
    input_profile: dict,
    computed_score: Optional[float],
    assigned_band: Optional[str],
    triggered_rules: list,
    factor_details: list,
    structured: dict,
) -> tuple:
    """
    Ask Claude: does this scenario result make sense? Are there issues?
    Returns (assessment_text, flagged_issues_list).
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return (
            "AI assessment unavailable — configure your Anthropic API key in Admin → Settings.",
            []
        )

    client = anthropic.Anthropic(api_key=api_key)

    prompt = (
        "You are a senior AML model validator. Review this scenario result and assess whether "
        "the model has classified this customer correctly under PTL (2017:630) and FFFS 2017:11.\n\n"
        f"Scenario: {scenario_name}\n"
        f"Input profile: {json.dumps(input_profile, indent=2)}\n"
        f"Computed score: {computed_score}\n"
        f"Assigned band: {assigned_band}\n"
        f"Triggered rules: {json.dumps(triggered_rules)}\n"
        f"Factor scoring breakdown: {json.dumps(factor_details, indent=2)}\n\n"
        "Model structure for reference:\n"
        + json.dumps({
            "bands": structured.get("bands", []),
            "triggers": structured.get("triggers", []),
        }, indent=2)[:2000]
        + "\n\n"
        "Return a JSON object with exactly two keys:\n"
        '  "assessment": string — 2-4 sentences on whether the classification is appropriate, '
        "any regulatory concerns, and whether the model handled this scenario correctly.\n"
        '  "flagged_issues": array of strings — specific issues found (empty array if none).\n\n'
        "Be concrete and reference specific factors or regulatory requirements. "
        "If the result looks correct, say so — do not manufacture issues."
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw.strip())
        return result.get("assessment", ""), result.get("flagged_issues", [])
    except Exception as e:
        print(f"[Valtior] Scenario AI assessment failed: {e}")
        return f"Assessment failed: {str(e)}", []
