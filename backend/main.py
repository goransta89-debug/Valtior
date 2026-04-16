"""
Valtior Backend — FastAPI Application Entry Point
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from database import engine, Base
from routers.projects import router as projects_router
from routers.risk_models import router as models_router, findings_router
from routers.reports import router as reports_router, compliance_router
from routers.admin import router as admin_router
from routers.scenarios import router as scenarios_router
from routers.remediation import router as remediation_router
from routers.impact import router as impact_router
from routers.versions import router as versions_router
from routers.audit_log import router as audit_router

# Create all database tables on startup (new tables only; won't touch existing ones)
Base.metadata.create_all(bind=engine)


def _run_migrations():
    """
    Lightweight migration runner.
    SQLAlchemy's create_all() creates new tables but won't add columns to existing ones.
    This function handles additive column migrations safely — it checks before altering.
    """
    with engine.connect() as conn:
        # Migration 1: Add lifecycle_stage to projects (added in v0.2)
        try:
            conn.execute(text("SELECT lifecycle_stage FROM projects LIMIT 1"))
        except Exception:
            conn.execute(text(
                "ALTER TABLE projects ADD COLUMN lifecycle_stage VARCHAR(50) DEFAULT 'validering'"
            ))
            conn.commit()

        # Migration 2: Add remediation fields to findings (added in v0.3)
        remediation_columns = [
            ("remediation_status",  "VARCHAR(50) DEFAULT 'open'"),
            ("remediation_owner",   "VARCHAR(200)"),
            ("remediation_note",    "TEXT DEFAULT ''"),
            ("remediation_due",     "VARCHAR(20)"),
            ("resolved_at",         "DATETIME"),
            ("resolved_in_version", "VARCHAR(20)"),
        ]
        for col_name, col_def in remediation_columns:
            try:
                conn.execute(text(f"SELECT {col_name} FROM findings LIMIT 1"))
            except Exception:
                conn.execute(text(f"ALTER TABLE findings ADD COLUMN {col_name} {col_def}"))
                conn.commit()

        # Migration 3: Add framework_dimension to findings (added in v0.4)
        try:
            conn.execute(text("SELECT framework_dimension FROM findings LIMIT 1"))
        except Exception:
            conn.execute(text("ALTER TABLE findings ADD COLUMN framework_dimension VARCHAR(50)"))
            conn.commit()

        # Migration 4: Add validation_opinion to risk_models (added in v0.4)
        try:
            conn.execute(text("SELECT validation_opinion FROM risk_models LIMIT 1"))
        except Exception:
            conn.execute(text("ALTER TABLE risk_models ADD COLUMN validation_opinion TEXT DEFAULT ''"))
            conn.commit()


_run_migrations()

app = FastAPI(
    title="Valtior API",
    description="Model Validation & Governance Platform — AML/KYC Focus",
    version="0.5.0",
    docs_url="/docs",       # Interactive API docs at http://localhost:8000/docs
    redoc_url="/redoc",
)

# Allow the React frontend (running on port 3000) to call this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(projects_router)
app.include_router(models_router)
app.include_router(findings_router)
app.include_router(reports_router)
app.include_router(compliance_router)
app.include_router(admin_router)
app.include_router(scenarios_router, prefix="/api/v1")
app.include_router(remediation_router)
app.include_router(impact_router, prefix="/api/v1")
app.include_router(versions_router)  # v0.4 — version comparison / diff
app.include_router(audit_router)     # v0.5 — audit trail


@app.get("/", tags=["Health"])
def health_check():
    return {
        "status": "ok",
        "product": "Valtior",
        "version": "0.5.0",
        "docs": "/docs"
    }
