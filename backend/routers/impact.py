"""
Portfolio Impact Analysis Router

Endpoints:
  GET  /api/v1/projects/{project_id}/models/{model_id}/portfolio-template
       → Download a CSV template pre-filled with the model's factor column headers

  POST /api/v1/projects/{project_id}/impact/analyse
       → Upload a portfolio CSV + specify two model versions → returns full impact analysis
"""

import json

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from database import get_db
import models as db_models
from services.impact_engine import (
    parse_portfolio_csv,
    run_impact_analysis,
    generate_portfolio_template,
)

router = APIRouter(tags=["Impact Analysis"])


def _get_parsed_model(project_id: str, model_id: str, db: Session) -> db_models.RiskModel:
    model = (
        db.query(db_models.RiskModel)
        .filter_by(id=model_id, project_id=project_id)
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail=f"Model '{model_id}' not found.")
    if model.parse_status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"Model v{model.version} is not yet parsed (status: {model.parse_status})."
        )
    if not model.structured:
        raise HTTPException(status_code=400, detail="Model has no structured data.")
    return model


# ── CSV template download ─────────────────────────────────────────────────────

@router.get(
    "/projects/{project_id}/models/{model_id}/portfolio-template",
    response_class=Response,
    summary="Download portfolio CSV template for this model",
)
def download_portfolio_template(
    project_id: str,
    model_id: str,
    db: Session = Depends(get_db),
):
    """
    Returns a CSV file with one header row (customer_ref + one column per risk factor)
    and one example data row. Fill in your customer portfolio data and upload it
    to the impact analysis endpoint.
    """
    model = _get_parsed_model(project_id, model_id, db)
    csv_content = generate_portfolio_template(model.structured)

    project = db.query(db_models.Project).filter_by(id=project_id).first()
    proj_name = (project.name or "model").replace(" ", "_")[:30]
    filename = f"portfolio_template_{proj_name}_v{model.version}.csv"

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Portfolio impact analysis ─────────────────────────────────────────────────

@router.post(
    "/projects/{project_id}/impact/analyse",
    summary="Upload portfolio and run impact analysis across two model versions",
)
async def analyse_portfolio_impact(
    project_id: str,
    from_model_id: str = Form(..., description="ID of the older model version"),
    to_model_id:   str = Form(..., description="ID of the newer model version"),
    portfolio:     UploadFile = File(..., description="CSV file with customer portfolio data"),
    db: Session = Depends(get_db),
):
    """
    Scores every customer in the uploaded portfolio under both model versions,
    computes band movements, maps them to regulatory obligations, and returns
    an AI-generated action plan.

    The CSV must have:
      - A first column with customer references (any header name)
      - One column per risk factor (headers should approximately match factor names)

    Download the portfolio template from the /portfolio-template endpoint to get
    the exact column headers for this model.

    No PII is required or stored — only factor values and customer references.
    """
    # Validate models
    old_model = _get_parsed_model(project_id, from_model_id, db)
    new_model = _get_parsed_model(project_id, to_model_id, db)

    if from_model_id == to_model_id:
        raise HTTPException(status_code=400, detail="Select two different model versions to compare.")

    # Validate file type
    filename = portfolio.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported. Download the template to get the correct format.")

    # Read and parse the portfolio
    content = await portfolio.read()
    if len(content) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(status_code=400, detail="Portfolio file too large. Maximum 10 MB / ~50,000 customers.")

    try:
        rows, columns = parse_portfolio_csv(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {str(e)}")

    if not rows:
        raise HTTPException(status_code=400, detail="The portfolio file is empty.")

    if len(rows) > 50_000:
        raise HTTPException(status_code=400, detail="Portfolio exceeds 50,000 customers. Split into smaller files.")

    # Run impact analysis
    try:
        result = run_impact_analysis(
            portfolio_rows=rows,
            old_model_structured=old_model.structured,
            new_model_structured=new_model.structured,
            old_version=old_model.version,
            new_version=new_model.version,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Impact analysis failed: {str(e)}")

    result["portfolio_filename"] = filename
    result["columns_detected"]   = columns
    return result


# ── Superadmin "what-if" simulation ───────────────────────────────────────────

@router.post(
    "/projects/{project_id}/models/{model_id}/whatif",
    summary="Simulate edited model parameters against a portfolio",
)
async def simulate_whatif(
    project_id: str,
    model_id: str,
    edited_structured: str = Form(..., description="JSON of edited structured params (risk_factors, bands, triggers, scoring)"),
    portfolio: UploadFile = File(..., description="CSV portfolio file"),
    db: Session = Depends(get_db),
):
    """
    Compares the current parsed model against an in-memory edited version
    using the existing impact engine. Does NOT persist the edits — purely a simulation.

    Used by the superadmin Configurator view to preview whether a parameter change
    (weight, band threshold, trigger) is material enough to require a
    formal remediation project, a targeted sprint, or routine handling.
    """
    model = _get_parsed_model(project_id, model_id, db)

    try:
        edited = json.loads(edited_structured)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid edited_structured JSON: {e}")

    if not isinstance(edited, dict):
        raise HTTPException(status_code=400, detail="edited_structured must be a JSON object.")

    filename = portfolio.filename or ""
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are supported.")

    content = await portfolio.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Portfolio file too large (max 10 MB).")

    try:
        rows, columns = parse_portfolio_csv(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {e}")

    if not rows:
        raise HTTPException(status_code=400, detail="The portfolio file is empty.")

    try:
        result = run_impact_analysis(
            portfolio_rows=rows,
            old_model_structured=model.structured,
            new_model_structured=edited,
            old_version=f"{model.version} (current)",
            new_version=f"{model.version} (edited)",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"What-if simulation failed: {e}")

    result["portfolio_filename"] = filename
    result["columns_detected"]   = columns
    result["simulation_mode"]    = "whatif"
    return result
