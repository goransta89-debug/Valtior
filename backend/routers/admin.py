"""
Admin Router — Platform settings, API key management, model register.

Endpoints:
  GET  /api/v1/admin/settings        — return current platform settings (key masked)
  PATCH /api/v1/admin/settings       — update settings
  GET  /api/v1/admin/model-register  — flat list of all models across all projects
"""

import os
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from database import get_db
import models as db_models
import schemas

router = APIRouter(prefix="/api/v1/admin", tags=["Admin"])


def _get_or_create_settings(db: Session) -> db_models.PlatformSettings:
    """Return the singleton settings row, creating it with defaults if absent."""
    s = db.query(db_models.PlatformSettings).filter_by(id="default").first()
    if not s:
        s = db_models.PlatformSettings(id="default")
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


# ── Settings ─────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=schemas.SettingsResponse)
def get_settings(db: Session = Depends(get_db)):
    """
    Return platform settings. The API key value is never returned —
    only a boolean indicating whether one is configured.
    """
    s = _get_or_create_settings(db)
    # Key is configured if stored in DB or present as env var
    key_configured = bool(s.anthropic_api_key) or bool(os.getenv("ANTHROPIC_API_KEY", ""))
    return schemas.SettingsResponse(
        org_name=s.org_name or "Valtior",
        org_logo_url=s.org_logo_url,
        regulatory_profile=s.regulatory_profile or ["PTL", "FFFS_2017_11", "FATF", "SIMPT_2024"],
        api_key_configured=key_configured,
        updated_at=s.updated_at,
    )


@router.patch("/settings", response_model=schemas.SettingsResponse)
def update_settings(payload: schemas.SettingsUpdate, db: Session = Depends(get_db)):
    """
    Update platform settings. Pass anthropic_api_key as empty string "" to clear it.
    Partial updates — only fields provided in the payload are changed.
    """
    s = _get_or_create_settings(db)

    if payload.org_name is not None:
        s.org_name = payload.org_name
    if payload.org_logo_url is not None:
        s.org_logo_url = payload.org_logo_url or None
    if payload.regulatory_profile is not None:
        s.regulatory_profile = payload.regulatory_profile
    if payload.anthropic_api_key is not None:
        # Empty string = clear the key (fall back to env var)
        s.anthropic_api_key = payload.anthropic_api_key or None
        # Immediately update the running process env var so parsing picks it up
        if payload.anthropic_api_key:
            os.environ["ANTHROPIC_API_KEY"] = payload.anthropic_api_key
        else:
            os.environ.pop("ANTHROPIC_API_KEY", None)

    db.commit()
    db.refresh(s)

    key_configured = bool(s.anthropic_api_key) or bool(os.getenv("ANTHROPIC_API_KEY", ""))
    return schemas.SettingsResponse(
        org_name=s.org_name or "Valtior",
        org_logo_url=s.org_logo_url,
        regulatory_profile=s.regulatory_profile or [],
        api_key_configured=key_configured,
        updated_at=s.updated_at,
    )


# ── Model Register ────────────────────────────────────────────────────────────

@router.get("/model-register", response_model=List[schemas.ModelRegisterEntry])
def model_register(db: Session = Depends(get_db)):
    """
    SIMPT model register — flat list of all model versions across all projects,
    ordered by creation date descending. Used for governance oversight.
    """
    models = (
        db.query(db_models.RiskModel)
        .join(db_models.Project, db_models.RiskModel.project_id == db_models.Project.id)
        .order_by(db_models.RiskModel.created_at.desc())
        .all()
    )
    result = []
    for m in models:
        result.append(schemas.ModelRegisterEntry(
            model_id=m.id,
            model_version=m.version,
            parse_status=m.parse_status,
            finding_count=len(m.findings),
            source_type=m.source_type,
            created_at=m.created_at,
            project_id=m.project_id,
            project_name=m.project.name,
            institution=m.project.institution,
            lifecycle_stage=m.project.lifecycle_stage or "validering",
        ))
    return result
