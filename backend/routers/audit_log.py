"""
Audit Log Router — read-only access to the immutable audit trail.

Endpoints:
  GET /api/v1/projects/{project_id}/audit  — entries for one project
  GET /api/v1/audit                        — all entries across the platform

Filters: action (comma-separated), entity_type, limit (default 200).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
import models as db_models

router = APIRouter(tags=["Audit"])


def _serialise(entry: db_models.AuditLog) -> dict:
    return {
        "id":          entry.id,
        "project_id":  entry.project_id,
        "actor":       entry.actor,
        "action":      entry.action,
        "entity_type": entry.entity_type,
        "entity_id":   entry.entity_id,
        "summary":     entry.summary,
        "details":     entry.details,
        "created_at":  entry.created_at.isoformat() if entry.created_at else None,
    }


def _apply_filters(query, action, entity_type):
    if action:
        actions = [a.strip() for a in action.split(",") if a.strip()]
        query = query.filter(db_models.AuditLog.action.in_(actions))
    if entity_type:
        query = query.filter(db_models.AuditLog.entity_type == entity_type)
    return query


@router.get("/api/v1/projects/{project_id}/audit")
def project_audit_log(
    project_id: str,
    action: Optional[str] = Query(None, description="Filter by action(s) — comma-separated"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Audit entries for a single project, newest first."""
    q = db.query(db_models.AuditLog).filter(db_models.AuditLog.project_id == project_id)
    q = _apply_filters(q, action, entity_type)
    entries = q.order_by(db_models.AuditLog.created_at.desc()).limit(limit).all()
    return {"total": len(entries), "items": [_serialise(e) for e in entries]}


@router.get("/api/v1/audit")
def global_audit_log(
    action: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Audit entries across the entire platform, newest first."""
    q = db.query(db_models.AuditLog)
    q = _apply_filters(q, action, entity_type)
    entries = q.order_by(db_models.AuditLog.created_at.desc()).limit(limit).all()
    return {"total": len(entries), "items": [_serialise(e) for e in entries]}
