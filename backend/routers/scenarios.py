"""
Scenarios Router

Endpoints:
  GET    /api/v1/projects/{project_id}/models/{model_id}/scenarios/
  POST   /api/v1/projects/{project_id}/models/{model_id}/scenarios/
  POST   /api/v1/projects/{project_id}/models/{model_id}/scenarios/generate
  GET    /api/v1/scenarios/library
  DELETE /api/v1/scenarios/{scenario_id}
"""

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session
from typing import List
import uuid
from datetime import datetime

from database import get_db
import models as db_models
import schemas
from services.scenario_engine import generate_scenarios_ai, run_scenario, REGULATORY_LIBRARY

router = APIRouter(tags=["Scenarios"])


def _get_parsed_model(project_id: str, model_id: str, db: Session) -> db_models.RiskModel:
    """Shared helper — validates the model exists, belongs to the project, and is parsed."""
    model = (
        db.query(db_models.RiskModel)
        .filter_by(id=model_id, project_id=project_id)
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Model not found.")
    if model.parse_status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"Model is not yet parsed (status: {model.parse_status}). "
                   "Wait for parsing to complete before running scenarios."
        )
    if not model.structured:
        raise HTTPException(status_code=400, detail="Model has no structured data.")
    return model


# ── List scenarios ────────────────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/models/{model_id}/scenarios/",
    response_model=List[schemas.ScenarioResponse],
)
def list_scenarios(project_id: str, model_id: str, db: Session = Depends(get_db)):
    """Return all scenarios for a model version, newest first."""
    scenarios = (
        db.query(db_models.Scenario)
        .filter_by(model_version_id=model_id)
        .order_by(db_models.Scenario.created_at.desc())
        .all()
    )
    return scenarios


# ── Regulatory library ────────────────────────────────────────────────────────

@router.get("/scenarios/library")
def get_library():
    """
    Return the built-in regulatory scenario library.
    Templates are based on FATF typologies and FFFS 2017:11 requirements.
    """
    return REGULATORY_LIBRARY


# ── Manual create + run ───────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/models/{model_id}/scenarios/",
    response_model=schemas.ScenarioResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_scenario(
    project_id: str,
    model_id: str,
    payload: schemas.ScenarioCreate,
    db: Session = Depends(get_db),
):
    """
    Create and immediately run a manual scenario.
    Scores the input profile against the model's risk factors and bands,
    then calls the AI for a validation assessment.
    """
    model = _get_parsed_model(project_id, model_id, db)

    result = run_scenario(
        input_profile=payload.input_profile,
        structured=model.structured,
        scenario_name=payload.name,
    )

    scenario = db_models.Scenario(
        id=str(uuid.uuid4()),
        model_version_id=model_id,
        name=payload.name,
        source="manual",
        input_profile=payload.input_profile,
        computed_score=result["computed_score"],
        assigned_band=result["assigned_band"],
        triggered_rules=result["triggered_rules"],
        ai_assessment=result["ai_assessment"],
        flagged_issues=result["flagged_issues"],
        created_at=datetime.utcnow(),
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return scenario


# ── AI generation ─────────────────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/models/{model_id}/scenarios/generate",
    response_model=List[schemas.ScenarioResponse],
    status_code=status.HTTP_201_CREATED,
)
def generate_scenarios(
    project_id: str,
    model_id: str,
    db: Session = Depends(get_db),
):
    """
    Ask Claude to generate 10 edge-case test scenarios for this model,
    then score and assess each one immediately.

    Deletes any previously auto-generated scenarios for this model version
    before inserting the new batch (so re-generating is clean).
    """
    model = _get_parsed_model(project_id, model_id, db)

    # Delete previous auto-generated scenarios for this model version
    db.query(db_models.Scenario).filter_by(
        model_version_id=model_id, source="auto_generated"
    ).delete()
    db.commit()

    # Generate scenario outlines from AI
    outlines = generate_scenarios_ai(structured=model.structured, raw_text=model.raw_text or "")

    created = []
    for outline in outlines:
        name = outline.get("name", "Unnamed Scenario")
        input_profile = outline.get("input_profile", {})

        # Run scoring + AI assessment for each outline
        result = run_scenario(
            input_profile=input_profile,
            structured=model.structured,
            scenario_name=name,
        )

        scenario = db_models.Scenario(
            id=str(uuid.uuid4()),
            model_version_id=model_id,
            name=name,
            source="auto_generated",
            input_profile=input_profile,
            computed_score=result["computed_score"],
            assigned_band=result["assigned_band"],
            triggered_rules=result["triggered_rules"],
            ai_assessment=(
                result["ai_assessment"]
                or outline.get("test_purpose", "")
            ),
            flagged_issues=result["flagged_issues"],
            created_at=datetime.utcnow(),
        )
        db.add(scenario)
        created.append(scenario)

    db.commit()
    for s in created:
        db.refresh(s)

    return created


# ── Library scenario — instantiate and run ────────────────────────────────────

@router.post(
    "/projects/{project_id}/models/{model_id}/scenarios/library/{lib_id}",
    response_model=schemas.ScenarioResponse,
    status_code=status.HTTP_201_CREATED,
)
def run_library_scenario(
    project_id: str,
    model_id: str,
    lib_id: str,
    db: Session = Depends(get_db),
):
    """
    Instantiate a library scenario template and run it against the model.
    The library provides a pre-defined input profile; we score it against
    the model's actual risk factors.
    """
    model = _get_parsed_model(project_id, model_id, db)

    template = next((t for t in REGULATORY_LIBRARY if t["id"] == lib_id), None)
    if not template:
        raise HTTPException(status_code=404, detail=f"Library scenario '{lib_id}' not found.")

    result = run_scenario(
        input_profile=template["input_profile"],
        structured=model.structured,
        scenario_name=template["name"],
    )

    scenario = db_models.Scenario(
        id=str(uuid.uuid4()),
        model_version_id=model_id,
        name=template["name"],
        source="library",
        input_profile=template["input_profile"],
        computed_score=result["computed_score"],
        assigned_band=result["assigned_band"],
        triggered_rules=result["triggered_rules"],
        ai_assessment=result["ai_assessment"] or template.get("test_purpose", ""),
        flagged_issues=result["flagged_issues"],
        created_at=datetime.utcnow(),
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)
    return scenario


# ── Delete scenario ───────────────────────────────────────────────────────────

@router.delete("/scenarios/{scenario_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_scenario(scenario_id: str, db: Session = Depends(get_db)):
    scenario = db.query(db_models.Scenario).filter_by(id=scenario_id).first()
    if not scenario:
        raise HTTPException(status_code=404, detail="Scenario not found.")
    db.delete(scenario)
    db.commit()
