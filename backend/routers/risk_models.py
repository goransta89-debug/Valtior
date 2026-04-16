"""
Risk Models Router
Handles: model uploads, parsing, validation, findings, scenarios.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import datetime
import json

from database import get_db
import models as db_models
import schemas
from services.parser import hash_text, parse_model_with_ai, run_structural_checks, validate_model_with_ai
from services.extractor import extract_text_from_file, detect_document_type

router = APIRouter(prefix="/api/v1/projects/{project_id}/models", tags=["Models"])
findings_router = APIRouter(prefix="/api/v1/findings", tags=["Findings"])


# ── Model upload & listing ────────────────────────────────────────────────────

@router.get("/", response_model=List[schemas.ModelResponse])
def list_models(project_id: str, db: Session = Depends(get_db)):
    """List all model versions for a project."""
    project = db.query(db_models.Project).filter(db_models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    versions = db.query(db_models.RiskModel)\
        .filter(db_models.RiskModel.project_id == project_id)\
        .order_by(db_models.RiskModel.created_at.desc()).all()
    result = []
    for v in versions:
        r = schemas.ModelResponse.model_validate(v)
        r.finding_count = len(v.findings)
        result.append(r)
    return result


@router.post("/", response_model=schemas.ModelResponse, status_code=status.HTTP_201_CREATED)
def upload_model(
    project_id: str,
    payload: schemas.ModelUpload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Upload a new model version. Triggers AI parsing in the background.
    The model is saved immediately; parsing updates it asynchronously.
    """
    project = db.query(db_models.Project).filter(db_models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Determine next version number
    existing = db.query(db_models.RiskModel)\
        .filter(db_models.RiskModel.project_id == project_id)\
        .count()
    version = f"1.{existing}" if existing > 0 else "1.0"

    content_hash = hash_text(payload.raw_text)

    # Check for duplicate (same hash = same content)
    duplicate = db.query(db_models.RiskModel)\
        .filter(db_models.RiskModel.project_id == project_id)\
        .filter(db_models.RiskModel.version_hash == content_hash).first()
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="This model content is identical to an existing version. No changes detected."
        )

    model = db_models.RiskModel(
        project_id   = project_id,
        version      = version,
        version_hash = content_hash,
        raw_text     = payload.raw_text,
        source_type  = payload.source_type,
        parse_status = "parsing",
    )
    db.add(model)
    db.commit()
    db.refresh(model)

    # Kick off parsing in the background so the API responds immediately
    background_tasks.add_task(_parse_and_validate, model.id)

    r = schemas.ModelResponse.model_validate(model)
    r.finding_count = 0
    return r


@router.post("/upload-file", response_model=schemas.ModelResponse, status_code=status.HTTP_201_CREATED)
async def upload_model_file(
    project_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Upload a model document (PDF, DOCX, XLSX, TXT).
    Text is extracted automatically before AI parsing begins.
    """
    project = db.query(db_models.Project).filter(db_models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Read and extract text from file
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:  # 20 MB limit
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 20 MB.")

    try:
        raw_text, source_type = extract_text_from_file(content, file.filename or "upload")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if len(raw_text.strip()) < 50:
        raise HTTPException(
            status_code=400,
            detail="Could not extract meaningful text from this file. "
                   "If it is a scanned PDF, please copy and paste the text manually."
        )

    # Determine next version number
    existing = db.query(db_models.RiskModel)\
        .filter(db_models.RiskModel.project_id == project_id).count()
    version = f"1.{existing}" if existing > 0 else "1.0"

    content_hash = hash_text(raw_text)

    duplicate = db.query(db_models.RiskModel)\
        .filter(db_models.RiskModel.project_id == project_id)\
        .filter(db_models.RiskModel.version_hash == content_hash).first()
    if duplicate:
        raise HTTPException(
            status_code=400,
            detail="This file content is identical to an existing version. No changes detected."
        )

    model = db_models.RiskModel(
        project_id   = project_id,
        version      = version,
        version_hash = content_hash,
        raw_text     = raw_text,
        source_type  = source_type,
        parse_status = "parsing",
    )
    db.add(model)
    db.commit()
    db.refresh(model)

    background_tasks.add_task(_parse_and_validate, model.id)

    r = schemas.ModelResponse.model_validate(model)
    r.finding_count = 0
    return r


@router.post("/{model_id}/retry", response_model=schemas.ModelResponse)
def retry_parsing(
    project_id: str,
    model_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db)
):
    """
    Re-trigger parsing for a model stuck on 'parsing' or in 'failed' state.
    Clears existing findings and restarts the full parse + validate pipeline.
    """
    model = db.query(db_models.RiskModel).filter(
        db_models.RiskModel.id == model_id,
        db_models.RiskModel.project_id == project_id
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model version not found")

    if model.parse_status == "parsed":
        raise HTTPException(status_code=400, detail="Model is already parsed. Delete it and re-upload to reparse.")

    # Clear old findings and reset status
    db.query(db_models.Finding).filter(db_models.Finding.model_version_id == model_id).delete()
    model.parse_status = "parsing"
    model.parse_errors = []
    model.structured   = None
    db.commit()
    db.refresh(model)

    background_tasks.add_task(_parse_and_validate, model.id)

    r = schemas.ModelResponse.model_validate(model)
    r.finding_count = 0
    return r


@router.get("/{model_id}", response_model=schemas.ModelResponse)
def get_model(project_id: str, model_id: str, db: Session = Depends(get_db)):
    """Get a specific model version."""
    model = db.query(db_models.RiskModel).filter(
        db_models.RiskModel.id == model_id,
        db_models.RiskModel.project_id == project_id
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model version not found")
    r = schemas.ModelResponse.model_validate(model)
    r.finding_count = len(model.findings)
    return r


@router.patch("/{model_id}/opinion", response_model=schemas.ModelResponse)
def save_validation_opinion(
    project_id: str,
    model_id: str,
    payload: schemas.ModelOpinionUpdate,
    db: Session = Depends(get_db),
):
    """
    Save or update the validator's signed opinion for a model version.
    The opinion is included in the PDF and PPTX reports.
    """
    model = db.query(db_models.RiskModel).filter(
        db_models.RiskModel.id == model_id,
        db_models.RiskModel.project_id == project_id,
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model version not found")

    model.validation_opinion = payload.validation_opinion
    db.commit()
    db.refresh(model)

    r = schemas.ModelResponse.model_validate(model)
    r.finding_count = len(model.findings)
    return r


# ── Findings ──────────────────────────────────────────────────────────────────

@findings_router.get("/model/{model_id}", response_model=List[schemas.FindingResponse])
def get_findings(model_id: str, db: Session = Depends(get_db)):
    """Get all findings for a model version, ordered by severity."""
    severity_order = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3, "Observation": 4}
    findings = db.query(db_models.Finding)\
        .filter(db_models.Finding.model_version_id == model_id).all()
    findings.sort(key=lambda f: severity_order.get(f.severity, 99))
    return findings


@findings_router.patch("/{finding_id}/annotate", response_model=schemas.FindingResponse)
def annotate_finding(
    finding_id: str,
    payload: schemas.FindingAnnotate,
    db: Session = Depends(get_db)
):
    """Accept, reject, or flag a finding for follow-up."""
    finding = db.query(db_models.Finding).filter(db_models.Finding.id == finding_id).first()
    if not finding:
        raise HTTPException(status_code=404, detail="Finding not found")
    valid_statuses = {"pending", "accepted", "rejected", "follow_up"}
    if payload.annotation_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Status must be one of: {valid_statuses}")
    finding.annotation_status = payload.annotation_status
    finding.annotation_note   = payload.annotation_note or ""
    finding.annotated_at      = datetime.utcnow()
    db.commit()
    db.refresh(finding)
    return finding


# ── Background task: parse + structural checks ────────────────────────────────

def _parse_and_validate(model_id: str):
    """
    Background task: parse the raw model text, run structural checks, then AI validation.
    Every code path is wrapped — if anything crashes, status is set to 'failed'
    with the error message, so the model never gets stuck on 'parsing' forever.
    """
    from database import SessionLocal
    db = SessionLocal()
    model = None
    try:
        model = db.query(db_models.RiskModel).filter(db_models.RiskModel.id == model_id).first()
        if not model:
            return

        project = db.query(db_models.Project).filter(db_models.Project.id == model.project_id).first()
        project_name = project.name if project else "Unnamed Model"

        # Step 1: detect document type (safe — defaults to 'unknown' on any error)
        try:
            doc_type = detect_document_type(model.raw_text or "")
        except Exception:
            doc_type = "unknown"

        # Step 2: AI parsing
        try:
            structured = parse_model_with_ai(model.raw_text or "", project_name, doc_type)
            model.structured   = structured
            model.parse_status = "parsed"
            model.parse_errors = []
        except Exception as e:
            print(f"[Valtior] Parse error for model {model_id}: {e}")
            model.parse_status = "failed"
            model.parse_errors = [str(e)]
            db.commit()
            return

        db.commit()

        # Step 3: Structural checks (deterministic — always runs, never blocks)
        try:
            raw_findings = run_structural_checks(model.structured)
            for rf in raw_findings:
                finding = db_models.Finding(
                    model_version_id     = model.id,
                    source               = rf["source"],
                    category             = rf["category"],
                    severity             = rf["severity"],
                    framework_dimension  = rf.get("framework_dimension"),
                    title                = rf["title"],
                    description          = rf["description"],
                    affected_elements    = rf.get("affected_elements", []),
                    recommendation       = rf["recommendation"],
                    regulatory_reference = rf.get("regulatory_reference"),
                )
                db.add(finding)
            db.commit()
        except Exception as e:
            print(f"[Valtior] Structural check error for model {model_id}: {e}")

        # Step 4: AI Validation — FFFS 2017:11 three-question framework
        # Only runs if API key is available; adds deep logic and assumption analysis
        try:
            ai_findings = validate_model_with_ai(model.structured, model.raw_text or "")
            for af in ai_findings:
                finding = db_models.Finding(
                    model_version_id     = model.id,
                    source               = "validation_engine",
                    category             = af.get("category", "logic_inconsistency"),
                    severity             = af.get("severity", "Medium"),
                    framework_dimension  = af.get("framework_dimension", "modellutformning"),
                    title                = af.get("title", "Validation finding"),
                    description          = af.get("description", ""),
                    affected_elements    = af.get("affected_elements", []),
                    recommendation       = af.get("recommendation", ""),
                    regulatory_reference = af.get("regulatory_reference"),
                )
                db.add(finding)
            db.commit()
        except Exception as e:
            print(f"[Valtior] AI validation error for model {model_id}: {e}")

    except Exception as e:
        # Outer safety net — catches anything not caught above and marks model as failed
        # This ensures the model never stays stuck on 'parsing' indefinitely
        print(f"[Valtior] Unexpected error in background task for model {model_id}: {e}")
        try:
            if model:
                model.parse_status = "failed"
                model.parse_errors = [f"Unexpected error: {str(e)}"]
                db.commit()
        except Exception:
            pass

    finally:
        db.close()
