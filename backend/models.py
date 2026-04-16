"""
Database models (SQLAlchemy ORM).
These define the tables that are created in SQLite / PostgreSQL.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, DateTime, Integer, Float, Boolean, JSON, ForeignKey
from sqlalchemy.orm import relationship
from database import Base


def new_uuid():
    return str(uuid.uuid4())


class Project(Base):
    """A validation engagement. E.g. 'Bank X — CRS Model Q1 2026'."""
    __tablename__ = "projects"

    id          = Column(String, primary_key=True, default=new_uuid)
    name        = Column(String(200), nullable=False)
    domain      = Column(String(50), default="AML_KYC")     # AML_KYC | TM | FRAUD | OTHER
    owner       = Column(String(200))                         # Model owner name or team
    institution = Column(String(200))                         # Client institution name
    status      = Column(String(50), default="active")        # active | validated | archived
    notes       = Column(Text, default="")
    # SIMPT lifecycle stage — which of the 7 phases is the model currently in?
    # Phases: initiering | modellutveckling | implementation | validering |
    #         modellanvandande | modelluppfoljning | lopande_validering
    lifecycle_stage = Column(String(50), default="validering")
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    model_versions = relationship("RiskModel", back_populates="project", cascade="all, delete")


class RiskModel(Base):
    """
    A specific version of a risk model within a project.
    Every upload or edit creates a new version — old ones are never overwritten.
    """
    __tablename__ = "risk_models"

    id             = Column(String, primary_key=True, default=new_uuid)
    project_id     = Column(String, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    version        = Column(String(20), default="1.0")         # Semantic version: 1.0, 1.1, 2.0
    version_hash   = Column(String(64))                         # SHA-256 of raw_text
    raw_text       = Column(Text, default="")                   # Original pasted / extracted text
    structured     = Column(JSON, default=None)                 # Parsed model JSON (see blueprint Section 4)
    parse_status   = Column(String(50), default="pending")      # pending | parsed | failed
    parse_errors   = Column(JSON, default=list)                 # List of parsing error messages
    source_type    = Column(String(50), default="text_paste")   # text_paste | pdf | docx | form
    # Validator's signed opinion — free text saved per model version (added v0.4)
    validation_opinion = Column(Text, nullable=True, default="")
    created_at     = Column(DateTime, default=datetime.utcnow)

    # Relationships
    project  = relationship("Project", back_populates="model_versions")
    findings = relationship("Finding", back_populates="model_version", cascade="all, delete")
    scenarios = relationship("Scenario", back_populates="model_version", cascade="all, delete")


class Finding(Base):
    """
    A single validation finding — from structural checks, AI analysis, or scenario testing.
    Always linked to the specific model version that produced it.
    """
    __tablename__ = "findings"

    id                  = Column(String, primary_key=True, default=new_uuid)
    model_version_id    = Column(String, ForeignKey("risk_models.id", ondelete="CASCADE"), nullable=False)
    source              = Column(String(50))    # structural_check | validation_engine | scenario_engine
    category            = Column(String(100))   # scoring_gap | logic_inconsistency | trigger_conflict | etc.
    severity            = Column(String(50))    # Critical | High | Medium | Low | Observation
    title               = Column(String(300))
    description         = Column(Text)
    affected_elements   = Column(JSON, default=list)   # e.g. ["risk_factors", "bands"]
    recommendation      = Column(Text)
    regulatory_reference = Column(String(300))
    # User annotation
    annotation_status   = Column(String(50), default="pending")   # pending | accepted | rejected | follow_up
    annotation_note     = Column(Text, default="")
    annotated_at        = Column(DateTime, nullable=True)
    # Frank Penny / SIMPT validation framework dimension (added v0.4)
    # modellutformning | data | implementation_testning | styrning_uppföljning
    framework_dimension = Column(String(50), nullable=True)
    # Remediation tracking (added v0.3)
    remediation_status  = Column(String(50), default="open")      # open | in_progress | resolved | accepted_risk
    remediation_owner   = Column(String(200), nullable=True)       # Name / team responsible
    remediation_note    = Column(Text, default="")                 # How it was resolved / why risk accepted
    remediation_due     = Column(String(20), nullable=True)        # ISO date string YYYY-MM-DD
    resolved_at         = Column(DateTime, nullable=True)
    resolved_in_version = Column(String(20), nullable=True)        # e.g. "1.2" — version that resolved it
    created_at          = Column(DateTime, default=datetime.utcnow)

    model_version = relationship("RiskModel", back_populates="findings")


class PlatformSettings(Base):
    """
    Singleton table — always exactly one row (id='default').
    Stores platform-level config: API keys, org branding, regulatory profile.
    """
    __tablename__ = "platform_settings"

    id                  = Column(String, primary_key=True, default="default")
    anthropic_api_key   = Column(String(200), nullable=True)   # Overrides env var when set
    org_name            = Column(String(200), default="Valtior")
    org_logo_url        = Column(String(500), nullable=True)
    # JSON list: ["PTL", "FFFS_2017_11", "FATF", "SIMPT_2024", "EU_AMLD6"]
    regulatory_profile  = Column(JSON, default=lambda: ["PTL", "FFFS_2017_11", "FATF", "SIMPT_2024"])
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Scenario(Base):
    """
    A test scenario run against a model version.
    Stores the input customer profile and the computed output.
    """
    __tablename__ = "scenarios"

    id               = Column(String, primary_key=True, default=new_uuid)
    model_version_id = Column(String, ForeignKey("risk_models.id", ondelete="CASCADE"), nullable=False)
    name             = Column(String(200))
    source           = Column(String(50), default="manual")   # manual | auto_generated
    input_profile    = Column(JSON)     # {factor_id: value_label, ...}
    computed_score   = Column(Float, nullable=True)
    assigned_band    = Column(String(100), nullable=True)
    triggered_rules  = Column(JSON, default=list)
    ai_assessment    = Column(Text, default="")
    flagged_issues   = Column(JSON, default=list)
    created_at       = Column(DateTime, default=datetime.utcnow)

    model_version = relationship("RiskModel", back_populates="scenarios")
