"""
Versions Router
---------------
Endpoints for comparing two model versions within the same project.

GET /api/v1/projects/{project_id}/versions/compare
  ?from_id=<model_id>&to_id=<model_id>

Returns a VersionDiffResponse with:
  - resolved findings (present in V_old, not in V_new)
  - new findings (present in V_new, not in V_old)
  - persisting findings (present in both)
  - structural_changes (plain-language list)
  - remediation_recommendation ("none" | "targeted" | "project")
  - recommendation_label / recommendation_summary (AI-written prose)
  - critical_remaining / high_remaining
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
import models as db_models
import schemas
from services.version_diff import compare_versions

router = APIRouter(prefix="/api/v1/projects/{project_id}", tags=["Versions"])


@router.get("/versions/compare", response_model=schemas.VersionDiffResponse)
def version_compare(
    project_id: str,
    from_id: str = Query(..., description="Model ID of the older version (V_old)"),
    to_id:   str = Query(..., description="Model ID of the newer version (V_new)"),
    db: Session = Depends(get_db),
):
    """
    Compare two parsed model versions within a project.

    The comparison engine uses fuzzy title matching to correlate findings
    across versions and Claude to generate a plain-language remediation assessment.
    """
    # Validate project exists
    project = db.query(db_models.Project).filter_by(id=project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    if from_id == to_id:
        raise HTTPException(
            status_code=400,
            detail="from_id and to_id must be different versions."
        )

    # Load both model versions — must belong to this project
    old_model = db.query(db_models.RiskModel).filter_by(
        id=from_id, project_id=project_id
    ).first()
    new_model = db.query(db_models.RiskModel).filter_by(
        id=to_id, project_id=project_id
    ).first()

    if not old_model:
        raise HTTPException(status_code=404, detail=f"'from' model version not found: {from_id}")
    if not new_model:
        raise HTTPException(status_code=404, detail=f"'to' model version not found: {to_id}")

    # Both must be parsed
    if old_model.parse_status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"'from' version (v{old_model.version}) is not parsed yet "
                   f"(status: {old_model.parse_status}). Wait for parsing to complete."
        )
    if new_model.parse_status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"'to' version (v{new_model.version}) is not parsed yet "
                   f"(status: {new_model.parse_status}). Wait for parsing to complete."
        )

    result = compare_versions(old_model=old_model, new_model=new_model)
    return result
