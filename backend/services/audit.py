"""
Audit logging service.

One helper — `log()` — that any router can call to record a validation action
in the immutable audit_log table. Failures are swallowed so audit problems
never block the primary action (regulatory pragmatism: prefer to log most
events even if a few are dropped, vs blocking user work).
"""

from sqlalchemy.orm import Session
from typing import Optional

import models as db_models


def log(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    project_id: Optional[str] = None,
    summary: str = "",
    details: Optional[dict] = None,
    actor: str = "validator",
) -> None:
    """
    Append an audit entry. Commits within the existing session.
    Never raises — audit failures are logged to stdout, not propagated.
    """
    try:
        entry = db_models.AuditLog(
            project_id=project_id,
            actor=actor,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary[:500] if summary else "",
            details=details or {},
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        print(f"[Valtior audit] Failed to log {action}/{entity_type}: {e}")
        try:
            db.rollback()
        except Exception:
            pass
