"""
Projects Router — CRUD for validation projects.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List

from database import get_db
import models as db_models
import schemas
from services import audit

router = APIRouter(prefix="/api/v1/projects", tags=["Projects"])


def _enrich_project(p: db_models.Project) -> schemas.ProjectResponse:
    """
    Build a ProjectResponse with RAG status derived from the latest parsed model's findings.
    RAG logic:
      RED   — any open Critical findings
      AMBER — any open High findings (no Critical)
      GREEN — model parsed, findings exist but none Critical/High
      NONE  — no parsed model yet
    """
    r = schemas.ProjectResponse.model_validate(p)
    r.model_count = len(p.model_versions)

    # Find the latest parsed model
    parsed = sorted(
        [mv for mv in p.model_versions if mv.parse_status == "parsed"],
        key=lambda mv: mv.created_at,
        reverse=True,
    )
    if not parsed:
        return r  # NONE — no parsed model

    latest = parsed[0]
    r.last_validated_at = latest.created_at

    # Count open findings by severity
    open_findings = [f for f in latest.findings if f.remediation_status != "resolved"]
    critical = sum(1 for f in open_findings if f.severity == "Critical")
    high     = sum(1 for f in open_findings if f.severity == "High")
    medium   = sum(1 for f in open_findings if f.severity == "Medium")

    r.open_critical = critical
    r.open_high     = high
    r.open_medium   = medium

    if critical > 0:
        r.rag_status = "RED"
    elif high > 0:
        r.rag_status = "AMBER"
    elif open_findings:
        r.rag_status = "GREEN"
    else:
        r.rag_status = "GREEN"  # Parsed, no open issues

    return r


@router.get("/", response_model=List[schemas.ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    """Return all projects, newest first, with RAG status derived from latest model findings."""
    projects = db.query(db_models.Project).order_by(db_models.Project.created_at.desc()).all()
    return [_enrich_project(p) for p in projects]


@router.post("/", response_model=schemas.ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: schemas.ProjectCreate, db: Session = Depends(get_db)):
    """Create a new validation project."""
    project = db_models.Project(**payload.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    audit.log(
        db,
        action="project_created",
        entity_type="project",
        entity_id=project.id,
        project_id=project.id,
        summary=f"Created project: {project.name}",
        details={"institution": project.institution, "lifecycle_stage": project.lifecycle_stage},
    )
    r = schemas.ProjectResponse.model_validate(project)
    r.model_count = 0
    return r


@router.get("/{project_id}", response_model=schemas.ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    """Get a single project by ID, with RAG status."""
    project = db.query(db_models.Project).filter(db_models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return _enrich_project(project)


@router.patch("/{project_id}", response_model=schemas.ProjectResponse)
def update_project(project_id: str, payload: schemas.ProjectUpdate, db: Session = Depends(get_db)):
    """Update project metadata."""
    project = db.query(db_models.Project).filter(db_models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    incoming = payload.model_dump(exclude_none=True)
    changes = {k: {"from": getattr(project, k, None), "to": v} for k, v in incoming.items() if getattr(project, k, None) != v}
    for field, value in incoming.items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    if changes:
        change_str = ", ".join(f"{k}: {v['from']!r}→{v['to']!r}" for k, v in changes.items())
        audit.log(
            db,
            action="project_updated",
            entity_type="project",
            entity_id=project.id,
            project_id=project.id,
            summary=change_str[:480],
            details={"changes": changes},
        )
    return _enrich_project(project)


@router.delete("/{project_id}", response_model=schemas.MessageResponse)
def delete_project(project_id: str, db: Session = Depends(get_db)):
    """Delete a project and all its associated data."""
    project = db.query(db_models.Project).filter(db_models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    return {"message": f"Project '{project.name}' deleted."}
