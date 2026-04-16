"""
Remediation Router

Endpoints:
  PATCH /api/v1/findings/{finding_id}/remediate      — update remediation status
  GET   /api/v1/projects/{project_id}/models/{model_id}/remediation-summary
                                                      — counts and overdue items
  GET   /api/v1/projects/{project_id}/versions/compare?from_id=&to_id=
                                                      — full version diff + AI recommendation
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
import models as db_models
import schemas
from services.version_diff import compare_versions

router = APIRouter(tags=["Remediation"])


# ── Update remediation status on a finding ────────────────────────────────────

@router.patch("/api/v1/findings/{finding_id}/remediate", response_model=schemas.FindingResponse)
def update_remediation(
    finding_id: str,
    payload: schemas.FindingRemediate,
    db: Session = Depends(get_db),
):
    """
    Update the remediation status of a finding.
    Automatically sets resolved_at timestamp when status transitions to 'resolved'.
    """
    finding = db.query(db_models.Finding).filter_by(id=finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found.")

    finding.remediation_status = payload.remediation_status

    if payload.remediation_owner is not None:
        finding.remediation_owner = payload.remediation_owner or None
    if payload.remediation_note is not None:
        finding.remediation_note = payload.remediation_note
    if payload.remediation_due is not None:
        finding.remediation_due = payload.remediation_due or None

    # Auto-set resolved_at timestamp on resolution
    if payload.remediation_status in ("resolved", "accepted_risk") and not finding.resolved_at:
        finding.resolved_at = datetime.utcnow()
    elif payload.remediation_status in ("open", "in_progress"):
        finding.resolved_at = None  # Re-opened

    db.commit()
    db.refresh(finding)
    return finding


# ── Remediation summary for a model version ───────────────────────────────────

@router.get("/api/v1/projects/{project_id}/models/{model_id}/remediation-summary")
def remediation_summary(
    project_id: str,
    model_id: str,
    db: Session = Depends(get_db),
):
    """
    Return remediation counts and overdue items for a model version.
    Used to show the remediation status bar in the UI.
    """
    findings = (
        db.query(db_models.Finding)
        .filter_by(model_version_id=model_id)
        .all()
    )

    today = datetime.utcnow().date().isoformat()

    counts = {"open": 0, "in_progress": 0, "resolved": 0, "accepted_risk": 0}
    overdue = []

    for f in findings:
        status = getattr(f, "remediation_status", "open") or "open"
        counts[status] = counts.get(status, 0) + 1

        due = getattr(f, "remediation_due", None)
        if due and status not in ("resolved", "accepted_risk") and due < today:
            overdue.append({
                "id": f.id,
                "title": f.title,
                "severity": f.severity,
                "remediation_due": due,
                "remediation_owner": getattr(f, "remediation_owner", None),
            })

    total = len(findings)
    resolved_count = counts["resolved"] + counts["accepted_risk"]
    progress_pct = round((resolved_count / total * 100)) if total > 0 else 0

    return {
        "total": total,
        "counts": counts,
        "overdue": overdue,
        "progress_pct": progress_pct,
        "resolved_count": resolved_count,
    }


# ── Cross-project overdue summary ─────────────────────────────────────────────

@router.get("/api/v1/remediation/overdue")
def overdue_across_projects(db: Session = Depends(get_db)):
    """
    Return all overdue remediation items across every project.
    An item is overdue if it has a remediation_due date in the past
    and remediation_status is neither 'resolved' nor 'accepted_risk'.

    Powers the cross-project overdue widget on the dashboard.
    """
    today = datetime.utcnow().date().isoformat()
    sev_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Observation": 4}

    rows = (
        db.query(db_models.Finding, db_models.RiskModel, db_models.Project)
        .join(db_models.RiskModel, db_models.Finding.model_version_id == db_models.RiskModel.id)
        .join(db_models.Project, db_models.RiskModel.project_id == db_models.Project.id)
        .filter(db_models.Finding.remediation_due.isnot(None))
        .filter(db_models.Finding.remediation_due != "")
        .filter(db_models.Finding.remediation_due < today)
        .filter(~db_models.Finding.remediation_status.in_(["resolved", "accepted_risk"]))
        .all()
    )

    today_date = datetime.utcnow().date()
    items = []
    for f, m, p in rows:
        try:
            days_overdue = (today_date - datetime.fromisoformat(f.remediation_due).date()).days
        except (ValueError, TypeError):
            days_overdue = 0
        items.append({
            "finding_id": f.id,
            "title": f.title,
            "severity": f.severity,
            "remediation_due": f.remediation_due,
            "remediation_owner": f.remediation_owner,
            "remediation_status": f.remediation_status,
            "days_overdue": days_overdue,
            "project_id": p.id,
            "project_name": p.name,
            "model_version": m.version,
        })

    items.sort(key=lambda x: (sev_order.get(x["severity"], 9), -x["days_overdue"]))
    return {"total": len(items), "items": items}


# ── Version comparison ────────────────────────────────────────────────────────

@router.get(
    "/api/v1/projects/{project_id}/versions/compare",
    response_model=schemas.VersionDiffResponse,
)
def compare_model_versions(
    project_id: str,
    from_id: str = Query(..., description="ID of the older model version"),
    to_id:   str = Query(..., description="ID of the newer model version"),
    db: Session = Depends(get_db),
):
    """
    Compare two model versions within the same project.
    Returns resolved/new/persisting findings, structural changes,
    and an AI-generated remediation recommendation.

    Both models must have parse_status='parsed'.
    """
    old_model = (
        db.query(db_models.RiskModel)
        .filter_by(id=from_id, project_id=project_id)
        .first()
    )
    new_model = (
        db.query(db_models.RiskModel)
        .filter_by(id=to_id, project_id=project_id)
        .first()
    )

    if not old_model:
        raise HTTPException(status_code=404, detail=f"Model version '{from_id}' not found.")
    if not new_model:
        raise HTTPException(status_code=404, detail=f"Model version '{to_id}' not found.")

    for m in (old_model, new_model):
        if m.parse_status != "parsed":
            raise HTTPException(
                status_code=400,
                detail=f"Version {m.version} is not yet parsed (status: {m.parse_status}). "
                       "Both versions must be fully parsed before comparison."
            )

    result = compare_versions(old_model, new_model)
    return schemas.VersionDiffResponse(**result)
