"""
Reports Router
--------------
Endpoints for generating and downloading PDF and PPTX validation reports.
Also exposes the regulatory compliance matrix as JSON (for frontend display).
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session
from datetime import datetime

from database import get_db
import models as db_models
from services.regulatory_map import assess_compliance, compliance_summary
from services.report_generator import generate_pdf_report, generate_pptx_report

router = APIRouter(prefix="/api/v1/projects/{project_id}/models/{model_id}", tags=["Reports"])
compliance_router = APIRouter(prefix="/api/v1", tags=["Compliance"])


def _get_model_and_findings(project_id: str, model_id: str, db: Session):
    """Shared helper — fetches project, model, and findings or raises 404."""
    project = db.query(db_models.Project).filter(db_models.Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    model = db.query(db_models.RiskModel).filter(
        db_models.RiskModel.id == model_id,
        db_models.RiskModel.project_id == project_id
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model version not found")

    if model.parse_status != "parsed":
        raise HTTPException(
            status_code=400,
            detail=f"Model is not yet parsed (status: {model.parse_status}). "
                   f"Wait for parsing to complete before generating a report."
        )

    findings = db.query(db_models.Finding)\
        .filter(db_models.Finding.model_version_id == model_id).all()

    return project, model, findings


@router.get("/report/pdf")
def download_pdf_report(project_id: str, model_id: str, db: Session = Depends(get_db)):
    """
    Generate and download a PDF validation report.
    Includes: executive summary, regulatory compliance matrix, detailed findings.
    """
    project, model, findings = _get_model_and_findings(project_id, model_id, db)

    findings_dicts = [
        {
            "severity":             f.severity,
            "title":                f.title,
            "description":          f.description,
            "recommendation":       f.recommendation,
            "regulatory_reference": f.regulatory_reference,
            "source":               f.source,
            "category":             f.category,
            "annotation_status":    f.annotation_status,
            "framework_dimension":  f.framework_dimension,  # v0.4 — Frank Penny / SIMPT dimension
        }
        for f in findings
    ]

    compliance_results = assess_compliance(model.structured or {}, findings_dicts)
    summary            = compliance_summary(compliance_results)

    pdf_bytes = generate_pdf_report(project, model, findings_dicts, compliance_results, summary)

    safe_name = project.name.replace(" ", "_").replace("/", "-")[:40]
    filename  = f"Valtior_ValidationReport_{safe_name}_v{model.version}_{datetime.now().strftime('%Y%m%d')}.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.get("/report/pptx")
def download_pptx_report(project_id: str, model_id: str, db: Session = Depends(get_db)):
    """
    Generate and download a PPTX executive presentation.
    Includes: cover, findings overview, regulatory matrix, finding slides, next steps.
    """
    project, model, findings = _get_model_and_findings(project_id, model_id, db)

    findings_dicts = [
        {
            "severity":             f.severity,
            "title":                f.title,
            "description":          f.description,
            "recommendation":       f.recommendation,
            "regulatory_reference": f.regulatory_reference,
            "source":               f.source,
            "category":             f.category,
            "annotation_status":    f.annotation_status,
            "framework_dimension":  f.framework_dimension,  # v0.4 — Frank Penny / SIMPT dimension
        }
        for f in findings
    ]

    compliance_results = assess_compliance(model.structured or {}, findings_dicts)
    summary            = compliance_summary(compliance_results)

    pptx_bytes = generate_pptx_report(project, model, findings_dicts, compliance_results, summary)

    safe_name = project.name.replace(" ", "_").replace("/", "-")[:40]
    filename  = f"Valtior_ValidationDeck_{safe_name}_v{model.version}_{datetime.now().strftime('%Y%m%d')}.pptx"

    return Response(
        content=pptx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@compliance_router.get("/projects/{project_id}/models/{model_id}/compliance")
def get_compliance_matrix(project_id: str, model_id: str, db: Session = Depends(get_db)):
    """
    Return the Swedish regulatory compliance matrix as JSON.
    Used by the frontend to show the compliance status inline.
    """
    project, model, findings = _get_model_and_findings(project_id, model_id, db)

    findings_dicts = [
        {"severity": f.severity, "category": f.category, "title": f.title}
        for f in findings
    ]

    compliance_results = assess_compliance(model.structured or {}, findings_dicts)
    summary            = compliance_summary(compliance_results)

    return {
        "summary": summary,
        "requirements": compliance_results,
    }
