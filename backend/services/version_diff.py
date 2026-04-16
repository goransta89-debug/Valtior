"""
Version Diff & Remediation Intelligence Service
------------------------------------------------
Compares two validated model versions to answer:
  1. Which findings were resolved between V_old and V_new?
  2. Which findings are new (introduced by the changes)?
  3. Which findings persist unchanged?
  4. What structural changes were made to the model?
  5. Does the change warrant: no action / targeted fix / formal remediation project?

Matching strategy: fuzzy title matching (lowercase, stripped) to correlate findings
across versions, since IDs differ between uploads.
"""

import os
import json
from typing import Optional
import anthropic


# ── Finding correlation ───────────────────────────────────────────────────────

def _normalise_title(title: str) -> str:
    """Normalise a finding title for fuzzy matching across versions."""
    return title.lower().strip().replace("–", "-").replace("—", "-")


def _match_findings(old_findings: list, new_findings: list) -> tuple[list, list, list]:
    """
    Match findings from V_old to V_new by normalised title similarity.

    Returns:
        resolved   — in old, not matched in new  (fixed or no longer triggered)
        new_only   — in new, not matched in old  (introduced by the changes)
        persisting — matched in both (still present regardless of changes)
    """
    old_map = {_normalise_title(f.title): f for f in old_findings}
    new_map = {_normalise_title(f.title): f for f in new_findings}

    old_keys = set(old_map.keys())
    new_keys = set(new_map.keys())

    # Exact matches — finding persists
    persisting_keys = old_keys & new_keys

    # Also do partial matching for titles that changed slightly
    unmatched_old = old_keys - persisting_keys
    unmatched_new = new_keys - persisting_keys

    for ok in list(unmatched_old):
        for nk in list(unmatched_new):
            # Match if either title contains the other (handles minor wording changes)
            if ok in nk or nk in ok or _token_overlap(ok, nk) >= 0.6:
                persisting_keys.add(ok)
                # Map new key back to the old title set for removal
                unmatched_old.discard(ok)
                unmatched_new.discard(nk)
                break

    resolved   = [_finding_to_dict(old_map[k]) for k in unmatched_old]
    new_only   = [_finding_to_dict(new_map[k]) for k in unmatched_new]
    persisting = [_finding_to_dict(new_map.get(_normalise_title(old_map[k].title),
                                               old_map[k]))
                  for k in persisting_keys if k in old_map]

    return resolved, new_only, persisting


def _token_overlap(a: str, b: str) -> float:
    """Simple token Jaccard similarity between two strings."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _finding_to_dict(finding) -> dict:
    """Convert ORM Finding object to a plain dict for JSON serialisation."""
    return {
        "id":                   finding.id,
        "severity":             finding.severity,
        "title":                finding.title,
        "description":          finding.description,
        "recommendation":       finding.recommendation,
        "category":             finding.category,
        "regulatory_reference": finding.regulatory_reference,
        "remediation_status":   getattr(finding, "remediation_status", "open"),
    }


# ── Structural diff ───────────────────────────────────────────────────────────

def _structural_diff(old_struct: dict, new_struct: dict) -> list[str]:
    """
    Compare two parsed model structures and return a plain-language list
    of what changed between them.
    """
    changes = []

    if not old_struct or not new_struct:
        return ["Full model structure comparison unavailable — one version is not parsed."]

    # Risk factors
    old_factors = {f.get("name", ""): f for f in old_struct.get("risk_factors", [])}
    new_factors = {f.get("name", ""): f for f in new_struct.get("risk_factors", [])}

    added_factors   = set(new_factors) - set(old_factors)
    removed_factors = set(old_factors) - set(new_factors)
    shared_factors  = set(old_factors) & set(new_factors)

    for name in added_factors:
        changes.append(f"New risk factor added: '{name}'")
    for name in removed_factors:
        changes.append(f"Risk factor removed: '{name}'")
    for name in shared_factors:
        ow = old_factors[name].get("weight")
        nw = new_factors[name].get("weight")
        if str(ow) != str(nw):
            changes.append(f"Weight changed for '{name}': {ow} → {nw}")

    # Bands
    old_bands = {b.get("name", ""): b for b in old_struct.get("bands", [])}
    new_bands = {b.get("name", ""): b for b in new_struct.get("bands", [])}
    added_bands   = set(new_bands) - set(old_bands)
    removed_bands = set(old_bands) - set(new_bands)
    for name in added_bands:
        changes.append(f"Risk band added: '{name}'")
    for name in removed_bands:
        changes.append(f"Risk band removed: '{name}'")
    for name in set(old_bands) & set(new_bands):
        ob, nb = old_bands[name], new_bands[name]
        if str(ob.get("min_score")) != str(nb.get("min_score")) or \
           str(ob.get("max_score")) != str(nb.get("max_score")):
            changes.append(
                f"Band thresholds changed for '{name}': "
                f"{ob.get('min_score')}–{ob.get('max_score')} → "
                f"{nb.get('min_score')}–{nb.get('max_score')}"
            )

    # Triggers
    old_triggers = {t.get("name", ""): t for t in old_struct.get("triggers", [])}
    new_triggers = {t.get("name", ""): t for t in new_struct.get("triggers", [])}
    for name in set(new_triggers) - set(old_triggers):
        changes.append(f"New trigger added: '{name}'")
    for name in set(old_triggers) - set(new_triggers):
        changes.append(f"Trigger removed: '{name}'")

    if not changes:
        changes.append("No structural changes detected in risk factors, bands, or triggers.")

    return changes


# ── Remediation intelligence ──────────────────────────────────────────────────

RECOMMENDATION_THRESHOLDS = {
    # (critical_remaining, high_remaining) → recommendation
    # Rule: any Critical remaining → at least "project"
    # Rule: 2+ High remaining → "targeted"
    # Rule: only Low/Medium/Observation → "none"
}


def _determine_recommendation(persisting: list, new_only: list) -> tuple[str, str]:
    """
    Determine remediation recommendation level from persisting + new findings.
    Returns (level, label).
    """
    all_open = persisting + new_only

    critical = sum(1 for f in all_open if f.get("severity") == "Critical")
    high     = sum(1 for f in all_open if f.get("severity") == "High")

    if critical >= 1:
        return "project", "Formal Remediation Project Required"
    elif high >= 2:
        return "targeted", "Targeted Remediation Sprint"
    elif high == 1:
        return "targeted", "Targeted Fix Needed"
    else:
        return "none", "No Formal Action Required"


def _ai_remediation_summary(
    from_version: str,
    to_version: str,
    resolved: list,
    new_only: list,
    persisting: list,
    structural_changes: list,
    recommendation: str,
) -> str:
    """
    Ask Claude to write a plain-language remediation assessment.
    Returns a 3-5 sentence explanation the client can understand.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        return (
            f"Version {to_version} resolved {len(resolved)} finding(s) compared to {from_version}. "
            f"{len(persisting)} finding(s) remain and {len(new_only)} new finding(s) were introduced. "
            "Configure your Anthropic API key in Settings for a detailed AI assessment."
        )

    client = anthropic.Anthropic(api_key=api_key)

    severity_summary = {}
    for f in persisting + new_only:
        sev = f.get("severity", "Unknown")
        severity_summary[sev] = severity_summary.get(sev, 0) + 1

    prompt = (
        "You are a senior AML model validation consultant. "
        "A client has submitted an updated version of their risk model. "
        "Compare the two versions and write a clear, plain-language assessment.\n\n"
        f"Version compared: {from_version} → {to_version}\n"
        f"Findings resolved: {len(resolved)}\n"
        f"New findings introduced: {len(new_only)}\n"
        f"Findings still present: {len(persisting)}\n"
        f"Remaining findings by severity: {json.dumps(severity_summary)}\n\n"
        "Structural changes made:\n"
        + "\n".join(f"  • {c}" for c in structural_changes) + "\n\n"
        "Resolved findings:\n"
        + "\n".join(f"  • [{f['severity']}] {f['title']}" for f in resolved[:6]) + "\n\n"
        "Still open findings:\n"
        + "\n".join(f"  • [{f['severity']}] {f['title']}" for f in (persisting + new_only)[:8]) + "\n\n"
        f"Remediation recommendation level: {recommendation.upper()}\n\n"
        "Write 3-5 sentences that:\n"
        "1. Acknowledge what the client fixed and whether those fixes adequately address the issues\n"
        "2. Explain clearly what still needs to be done and why it matters\n"
        "3. State the recommendation (no action / targeted sprint / formal project) and what it means in practice\n\n"
        "Be direct and specific. Reference regulatory requirements where the remaining issues are compliance-critical. "
        "Do not use bullet points — write in flowing prose. "
        "Do not start with 'I' or 'This assessment'."
    )

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content[0].text.strip()
    except Exception as e:
        print(f"[Valtior] Remediation summary AI call failed: {e}")
        return (
            f"Version {to_version} resolved {len(resolved)} finding(s) and introduced "
            f"{len(new_only)} new one(s). {len(persisting)} finding(s) remain open."
        )


# ── Main entry point ──────────────────────────────────────────────────────────

def compare_versions(old_model, new_model) -> dict:
    """
    Compare two RiskModel ORM objects and return a complete diff result.

    Args:
        old_model: RiskModel — the earlier version (V_old)
        new_model: RiskModel — the newer version (V_new)

    Returns dict matching schemas.VersionDiffResponse fields.
    """
    old_findings = list(old_model.findings)
    new_findings = list(new_model.findings)

    resolved, new_only, persisting = _match_findings(old_findings, new_findings)

    structural_changes = _structural_diff(
        old_model.structured or {},
        new_model.structured or {},
    )

    recommendation, recommendation_label = _determine_recommendation(persisting, new_only)

    critical_remaining = sum(1 for f in persisting + new_only if f.get("severity") == "Critical")
    high_remaining     = sum(1 for f in persisting + new_only if f.get("severity") == "High")

    summary = _ai_remediation_summary(
        from_version=old_model.version,
        to_version=new_model.version,
        resolved=resolved,
        new_only=new_only,
        persisting=persisting,
        structural_changes=structural_changes,
        recommendation=recommendation,
    )

    return {
        "from_version":              old_model.version,
        "to_version":                new_model.version,
        "from_model_id":             old_model.id,
        "to_model_id":               new_model.id,
        "resolved_findings":         resolved,
        "new_findings":              new_only,
        "persisting_findings":       persisting,
        "structural_changes":        structural_changes,
        "remediation_recommendation": recommendation,
        "recommendation_label":      recommendation_label,
        "recommendation_summary":    summary,
        "critical_remaining":        critical_remaining,
        "high_remaining":            high_remaining,
    }
