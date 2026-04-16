"""
Portfolio Impact Engine
-----------------------
When a model changes (new version), this engine:

  1. Loads an anonymised customer portfolio (customer_ref + factor values)
  2. Scores each customer under BOTH model versions (deterministic, no AI)
  3. Computes band movements per customer (from_band → to_band)
  4. Maps each movement type to its regulatory obligation under PTL / FFFS 2017:11
  5. Aggregates into a structured impact summary
  6. Makes one AI call to synthesise an action plan and remediation recommendation

No PII is ever required. The portfolio only needs customer_ref and factor values.

Scoring is fully deterministic — the same logic as scenario_engine.run_scenario()
but without the AI assessment step, so it runs at portfolio scale efficiently.
"""

import os
import json
import io
import csv
from typing import Optional
import anthropic


# ── Regulatory obligation matrix ──────────────────────────────────────────────
# Maps (from_band_normalised, to_band_normalised) → obligation definition.
# Bands normalised to lowercase single word: low | medium | high | veryhigh

OBLIGATION_MATRIX = {
    # Escalations — customer becomes higher risk
    ("low",    "medium"):   {
        "obligation": "CDD review at next periodic review cycle",
        "urgency":    "low",
        "urgency_label": "Routine",
        "timeline":   "Next scheduled review",
        "law":        "PTL 6 kap. 1§",
        "action_type": "periodic_review",
    },
    ("low",    "high"):     {
        "obligation": "CDD review and enhanced monitoring within 60 days",
        "urgency":    "medium",
        "urgency_label": "Within 60 days",
        "timeline":   "60 days",
        "law":        "FFFS 2017:11 §15 · PTL 3 kap. 1§",
        "action_type": "cdd_review",
    },
    ("low",    "veryhigh"): {
        "obligation": "Immediate Enhanced Due Diligence (EDD) and senior management approval required",
        "urgency":    "critical",
        "urgency_label": "Immediate",
        "timeline":   "Immediate — within 10 business days",
        "law":        "PTL 3 kap. 14§ · FFFS 2017:11 §16",
        "action_type": "edd_project",
    },
    ("medium", "high"):     {
        "obligation": "CDD review and enhanced monitoring within 60 days",
        "urgency":    "medium",
        "urgency_label": "Within 60 days",
        "timeline":   "60 days",
        "law":        "FFFS 2017:11 §15 · PTL 3 kap. 1§",
        "action_type": "cdd_review",
    },
    ("medium", "veryhigh"): {
        "obligation": "Immediate Enhanced Due Diligence (EDD) and senior management approval required",
        "urgency":    "critical",
        "urgency_label": "Immediate",
        "timeline":   "Immediate — within 10 business days",
        "law":        "PTL 3 kap. 14§ · FFFS 2017:11 §16",
        "action_type": "edd_project",
    },
    ("high",   "veryhigh"): {
        "obligation": "EDD enhancement — review and update existing EDD documentation",
        "urgency":    "high",
        "urgency_label": "Within 30 days",
        "timeline":   "30 days",
        "law":        "FFFS 2017:11 §16 · PTL 3 kap. 14§",
        "action_type": "edd_update",
    },
    # De-escalations — customer becomes lower risk
    ("high",   "medium"):   {
        "obligation": "Document de-escalation rationale. Compliance sign-off required.",
        "urgency":    "low",
        "urgency_label": "Routine",
        "timeline":   "Next review cycle",
        "law":        "PTL 6 kap. 1§",
        "action_type": "deescalation_review",
    },
    ("high",   "low"):      {
        "obligation": "Full de-escalation review and compliance sign-off. Document justification.",
        "urgency":    "medium",
        "urgency_label": "Within 30 days",
        "timeline":   "30 days",
        "law":        "PTL 6 kap. 1§ · FFFS 2017:11 §14",
        "action_type": "deescalation_review",
    },
    ("veryhigh", "high"):   {
        "obligation": "De-escalation review. Document rationale and obtain compliance sign-off.",
        "urgency":    "medium",
        "urgency_label": "Within 30 days",
        "timeline":   "30 days",
        "law":        "PTL 6 kap. 1§",
        "action_type": "deescalation_review",
    },
    ("veryhigh", "medium"): {
        "obligation": "Significant de-escalation — senior management sign-off and full documentation required.",
        "urgency":    "high",
        "urgency_label": "Within 30 days",
        "timeline":   "30 days",
        "law":        "PTL 6 kap. 1§ · FFFS 2017:11 §14",
        "action_type": "deescalation_review",
    },
    ("veryhigh", "low"):    {
        "obligation": "Major de-escalation — board-level or senior management sign-off required. Full documentation.",
        "urgency":    "high",
        "urgency_label": "Within 30 days",
        "timeline":   "30 days",
        "law":        "PTL 6 kap. 1§ · FFFS 2017:11 §14",
        "action_type": "deescalation_review",
    },
    # No change
    ("same",   "same"):     {
        "obligation": "No action required — customer band unchanged.",
        "urgency":    "none",
        "urgency_label": "No action",
        "timeline":   "—",
        "law":        "—",
        "action_type": "none",
    },
}


def _normalise_band(band: Optional[str]) -> str:
    """Normalise a band name to a consistent key for matrix lookup."""
    if not band:
        return "unknown"
    b = band.lower().replace(" ", "").replace("-", "").replace("_", "")
    if "veryhigh" in b or "critical" in b:
        return "veryhigh"
    if "high" in b:
        return "high"
    if "medium" in b or "moderate" in b:
        return "medium"
    if "low" in b:
        return "low"
    return b


def _get_obligation(from_band: str, to_band: str) -> dict:
    """Look up regulatory obligation for a band movement."""
    fn = _normalise_band(from_band)
    tn = _normalise_band(to_band)
    if fn == tn:
        return OBLIGATION_MATRIX[("same", "same")]
    return OBLIGATION_MATRIX.get(
        (fn, tn),
        {
            "obligation": f"Review required: band changed from {from_band} to {to_band}",
            "urgency": "medium",
            "urgency_label": "Within 60 days",
            "timeline": "60 days",
            "law": "PTL 6 kap. 1§",
            "action_type": "review",
        }
    )


# ── Deterministic scoring (no AI) ─────────────────────────────────────────────

def _score_customer(customer_row: dict, structured: dict) -> tuple[Optional[float], Optional[str]]:
    """
    Score a single customer row against a parsed model structure.
    Returns (computed_score_0_to_100, assigned_band_name).
    No AI involved — fully deterministic.
    """
    risk_factors = structured.get("risk_factors", [])
    bands        = structured.get("bands", [])
    triggers     = structured.get("triggers", [])

    total_weight  = 0.0
    weighted_sum  = 0.0

    for factor in risk_factors:
        fname = factor.get("name", "")
        weight_raw = factor.get("weight", 0)

        try:
            if isinstance(weight_raw, str):
                weight = float(weight_raw.strip("%")) / 100
            elif isinstance(weight_raw, (int, float)) and weight_raw > 1:
                weight = float(weight_raw) / 100
            else:
                weight = float(weight_raw)
        except (ValueError, TypeError):
            weight = 0.0

        # Find the matching column in the customer row (fuzzy key match)
        selected_label = None
        for col_key, col_val in customer_row.items():
            if col_key.lower() in fname.lower() or fname.lower() in col_key.lower():
                selected_label = str(col_val).strip()
                break

        if not selected_label or selected_label in ("", "-", "n/a", "none"):
            continue

        # Find the score for the selected value
        value_score = None
        for vl in factor.get("value_labels", []):
            vl_label = str(vl.get("label", "")).lower()
            if vl_label in selected_label.lower() or selected_label.lower() in vl_label:
                try:
                    value_score = float(vl.get("score", 0))
                except (ValueError, TypeError):
                    value_score = 0.0
                break

        if value_score is None:
            continue

        total_weight += weight
        weighted_sum += weight * value_score

    # Normalise to 0–100
    scoring_info = structured.get("scoring", {})
    score_max    = scoring_info.get("score_range", {}).get("max", 5) or 5

    if total_weight <= 0:
        return None, None

    raw_score      = weighted_sum / total_weight
    computed_score = round((raw_score / score_max) * 100, 1)

    # Check triggers — may override band
    trigger_band = None
    for trigger in triggers:
        t_condition = str(trigger.get("condition", "")).lower()
        t_action    = str(trigger.get("action", "")).lower()
        for col_val in customer_row.values():
            if str(col_val).lower() in t_condition:
                if "very high" in t_action or "override" in t_action or "escalat" in t_action:
                    trigger_band = "Very High"
                break

    if trigger_band:
        return computed_score, trigger_band

    # Assign band from score
    assigned_band = None
    for band in bands:
        try:
            b_min = float(band.get("min_score", 0))
            b_max = float(band.get("max_score", 100))
            if b_min <= computed_score <= b_max:
                assigned_band = band.get("name")
                break
        except (ValueError, TypeError):
            continue

    return computed_score, assigned_band


# ── Portfolio parsing ─────────────────────────────────────────────────────────

def parse_portfolio_csv(content: bytes) -> tuple[list[dict], list[str]]:
    """
    Parse an uploaded CSV portfolio file.
    Returns (rows, column_names).
    First column is treated as the customer reference ID.
    """
    text = content.decode("utf-8-sig", errors="replace")  # utf-8-sig strips BOM
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        # Strip whitespace from all values
        rows.append({k.strip(): v.strip() for k, v in row.items() if k})
    columns = list(reader.fieldnames or [])
    return rows, columns


# ── Main impact analysis ──────────────────────────────────────────────────────

def run_impact_analysis(
    portfolio_rows: list[dict],
    old_model_structured: dict,
    new_model_structured: dict,
    old_version: str,
    new_version: str,
) -> dict:
    """
    Score the entire portfolio under both model versions and compute impact.

    Returns a structured result dict with:
      - band_movement_matrix: count of customers per (from→to) pair
      - action_groups: grouped by regulatory action type
      - customer_movements: individual customer results (capped at 500 for storage)
      - obligation_summary: unique obligations triggered
      - ai_action_plan: AI-generated remediation recommendation
      - stats: total customers, changed count, etc.
    """
    id_col = None  # First column detected as customer ID

    movements        = []  # Individual customer results
    movement_matrix  = {}  # {(from_band, to_band): count}
    action_groups    = {}  # {action_type: [customer_refs]}

    for i, row in enumerate(portfolio_rows):
        cols = list(row.keys())
        if not id_col and cols:
            id_col = cols[0]  # Assume first column is customer reference

        customer_ref = row.get(id_col, f"Customer-{i+1}")

        # Score under both models
        score_old, band_old = _score_customer(row, old_model_structured)
        score_new, band_new = _score_customer(row, new_model_structured)

        # Obligation lookup
        obligation = _get_obligation(band_old or "unknown", band_new or "unknown")

        movement = {
            "customer_ref":  customer_ref,
            "band_old":      band_old or "Unknown",
            "band_new":      band_new or "Unknown",
            "score_old":     score_old,
            "score_new":     score_new,
            "action_type":   obligation["action_type"],
            "obligation":    obligation["obligation"],
            "urgency":       obligation["urgency"],
            "urgency_label": obligation["urgency_label"],
            "law":           obligation["law"],
            "changed":       (band_old != band_new),
        }
        movements.append(movement)

        # Matrix count
        key = (band_old or "Unknown", band_new or "Unknown")
        movement_matrix[key] = movement_matrix.get(key, 0) + 1

        # Group by action type
        atype = obligation["action_type"]
        if atype not in action_groups:
            action_groups[atype] = {"count": 0, "obligation": obligation, "customers": []}
        action_groups[atype]["count"] += 1
        if len(action_groups[atype]["customers"]) < 20:  # Keep sample for display
            action_groups[atype]["customers"].append(customer_ref)

    # Stats
    total        = len(movements)
    changed      = sum(1 for m in movements if m["changed"])
    escalated    = sum(1 for m in movements if _normalise_band(m["band_new"]) > _normalise_band(m["band_old"]) if m["band_old"] != "Unknown" and m["band_new"] != "Unknown")
    edd_required = sum(1 for m in movements if m["action_type"] in ("edd_project", "edd_update"))

    # Serialise matrix with string keys
    matrix_serialised = {
        f"{k[0]} → {k[1]}": v
        for k, v in sorted(movement_matrix.items(), key=lambda x: -x[1])
    }

    # AI action plan
    action_plan = _ai_action_plan(
        total=total,
        changed=changed,
        edd_required=edd_required,
        action_groups=action_groups,
        matrix_serialised=matrix_serialised,
        old_version=old_version,
        new_version=new_version,
    )

    # Determine remediation recommendation
    if edd_required > 0:
        recommendation       = "project"
        recommendation_label = "Formal Remediation Project Required"
    elif changed > 0 and any(g["obligation"]["urgency"] in ("medium", "high")
                              for g in action_groups.values()):
        recommendation       = "targeted"
        recommendation_label = "Targeted Remediation Sprint"
    else:
        recommendation       = "none"
        recommendation_label = "No Formal Action Required"

    return {
        "old_version":          old_version,
        "new_version":          new_version,
        "total_customers":      total,
        "changed_customers":    changed,
        "unchanged_customers":  total - changed,
        "edd_required":         edd_required,
        "band_movement_matrix": matrix_serialised,
        "action_groups":        {
            k: {
                "count":       v["count"],
                "obligation":  v["obligation"]["obligation"],
                "urgency":     v["obligation"]["urgency"],
                "urgency_label": v["obligation"]["urgency_label"],
                "timeline":    v["obligation"]["timeline"],
                "law":         v["obligation"]["law"],
                "sample_customers": v["customers"],
            }
            for k, v in action_groups.items()
            if k != "none"
        },
        "ai_action_plan":       action_plan,
        "recommendation":       recommendation,
        "recommendation_label": recommendation_label,
        # Include individual movements (cap at 500 rows for response size)
        "customer_movements":   movements[:500],
        "movements_truncated":  total > 500,
    }


# ── AI action plan generation ─────────────────────────────────────────────────

def _ai_action_plan(
    total: int,
    changed: int,
    edd_required: int,
    action_groups: dict,
    matrix_serialised: dict,
    old_version: str,
    new_version: str,
) -> str:
    """
    Ask Claude to synthesise the impact into a concrete action plan.
    One AI call for the entire portfolio — not per customer.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        parts = [f"Portfolio impact analysis: {changed} of {total} customers changed risk band."]
        if edd_required > 0:
            parts.append(
                f"{edd_required} customers require Enhanced Due Diligence (EDD) under "
                f"PTL 3 kap. 14§ and FFFS 2017:11 §16. A formal remediation project is warranted."
            )
        parts.append("Configure your API key in Settings for a detailed AI action plan.")
        return " ".join(parts)

    client = anthropic.Anthropic(api_key=api_key)

    groups_summary = "\n".join(
        f"  • {atype}: {data['count']} customers — {data['obligation']['obligation']} "
        f"({data['obligation']['urgency_label']}, {data['obligation']['law']})"
        for atype, data in action_groups.items()
        if atype != "none"
    )

    prompt = (
        "You are a senior AML compliance consultant. "
        "A bank has updated their customer risk model and you have computed the portfolio impact. "
        "Write a clear, actionable assessment for the compliance team.\n\n"
        f"Model change: version {old_version} → {new_version}\n"
        f"Portfolio size: {total} customers\n"
        f"Customers with changed risk band: {changed} ({round(changed/total*100) if total else 0}%)\n"
        f"Customers requiring EDD: {edd_required}\n\n"
        "Band movement breakdown:\n"
        + "\n".join(f"  • {k}: {v} customers" for k, v in list(matrix_serialised.items())[:10])
        + "\n\nAction groups:\n"
        + (groups_summary or "  No significant actions required.")
        + "\n\n"
        "Write 4-6 sentences that:\n"
        "1. Summarise the overall impact of the model change on the customer portfolio\n"
        "2. Call out the most urgent actions (EDD, immediate escalations) with specific customer counts\n"
        "3. Describe any CDD review workload and realistic timeline\n"
        "4. State clearly whether this warrants a formal remediation project, a targeted sprint, "
        "or can be handled within routine review cycles\n"
        "5. Reference the specific regulatory obligations (PTL, FFFS 2017:11) that apply\n\n"
        "Be direct and specific. Use exact customer counts. "
        "Do not use bullet points — write in flowing prose. "
        "A compliance director should be able to read this and immediately know what to do."
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text.strip()
    except Exception as e:
        print(f"[Valtior] Impact AI action plan failed: {e}")
        return (
            f"{changed} of {total} customers changed risk band. "
            f"{edd_required} require EDD under PTL 3 kap. 14§ and FFFS 2017:11 §16."
        )


# ── CSV template generator ────────────────────────────────────────────────────

def generate_portfolio_template(structured: dict) -> str:
    """
    Generate a CSV template with columns for customer_ref + each risk factor.
    The user fills this in with their customer data and uploads it.
    """
    factors = structured.get("risk_factors", [])
    headers = ["customer_ref"] + [f.get("name", f"factor_{i}") for i, f in enumerate(factors)]

    lines = [",".join(f'"{h}"' for h in headers)]

    # Add one example row with placeholder values
    example_values = ["CUST-001"]
    for factor in factors:
        value_labels = factor.get("value_labels", [])
        if value_labels:
            example_values.append(str(value_labels[0].get("label", "example")))
        else:
            example_values.append("example_value")
    lines.append(",".join(f'"{v}"' for v in example_values))

    return "\n".join(lines)
