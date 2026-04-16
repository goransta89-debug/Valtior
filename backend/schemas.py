"""
Pydantic schemas — define the shape of data coming IN and going OUT of the API.
Separate from DB models intentionally: the API contract can evolve independently of the DB.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime


# ── Projects ────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200, example="Bank X — CRS Model Q1 2026")
    domain: str = Field(default="AML_KYC", example="AML_KYC")
    owner: Optional[str] = Field(default=None, example="Compliance Team")
    institution: Optional[str] = Field(default=None, example="First National Bank")
    notes: Optional[str] = Field(default="")
    lifecycle_stage: str = Field(
        default="validering",
        example="validering",
        description=(
            "SIMPT model lifecycle stage: "
            "initiering | modellutveckling | implementation | validering | "
            "modellanvandande | modelluppfoljning | lopande_validering"
        )
    )


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    owner: Optional[str] = None
    institution: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None
    lifecycle_stage: Optional[str] = None


class ProjectResponse(BaseModel):
    id: str
    name: str
    domain: str
    owner: Optional[str]
    institution: Optional[str]
    status: str
    notes: str
    lifecycle_stage: str = "validering"
    created_at: datetime
    updated_at: datetime
    model_count: int = 0
    # Dashboard RAG fields — computed from latest parsed model's findings (v0.4)
    rag_status: str = "NONE"          # RED | AMBER | GREEN | NONE
    open_critical: int = 0
    open_high: int = 0
    open_medium: int = 0
    last_validated_at: Optional[Any] = None   # created_at of latest parsed model

    class Config:
        from_attributes = True


# ── Risk Models ──────────────────────────────────────────────────────────────

class ModelUpload(BaseModel):
    raw_text: str = Field(..., min_length=10, description="Pasted model text or policy excerpt")
    source_type: str = Field(default="text_paste", example="text_paste")


class ModelResponse(BaseModel):
    id: str
    project_id: str
    version: str
    version_hash: Optional[str]
    raw_text: str
    structured: Optional[Any]
    parse_status: str
    parse_errors: List[Any]
    source_type: str
    validation_opinion: Optional[str] = ""   # v0.4 — validator's signed opinion
    created_at: datetime
    finding_count: int = 0

    class Config:
        from_attributes = True


class ModelOpinionUpdate(BaseModel):
    validation_opinion: str = Field(default="", description="Validator's signed opinion on model fitness")


# ── Findings ─────────────────────────────────────────────────────────────────

class FindingResponse(BaseModel):
    id: str
    model_version_id: str
    source: str
    category: str
    severity: str
    # Frank Penny / SIMPT kontrollramverk dimension
    # modellutformning | data | implementation_testning | styrning_uppföljning
    framework_dimension: Optional[str] = None
    title: str
    description: str
    affected_elements: List[str]
    recommendation: str
    regulatory_reference: Optional[str]
    annotation_status: str
    annotation_note: str
    remediation_status: str = "open"
    remediation_owner: Optional[str] = None
    remediation_note: str = ""
    remediation_due: Optional[str] = None
    resolved_at: Optional[Any] = None
    resolved_in_version: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class FindingAnnotate(BaseModel):
    annotation_status: str = Field(..., example="accepted")  # accepted | rejected | follow_up | pending
    annotation_note: Optional[str] = Field(default="")


class FindingRemediate(BaseModel):
    remediation_status: str = Field(..., example="in_progress")  # open | in_progress | resolved | accepted_risk
    remediation_owner: Optional[str] = Field(default=None)
    remediation_note: Optional[str] = Field(default="")
    remediation_due: Optional[str] = Field(default=None)   # YYYY-MM-DD


# ── Version Diff ──────────────────────────────────────────────────────────────

class VersionDiffResponse(BaseModel):
    from_version: str
    to_version: str
    from_model_id: str
    to_model_id: str
    resolved_findings: List[Any]      # findings in V_old not in V_new (by title match)
    new_findings: List[Any]           # findings in V_new not in V_old
    persisting_findings: List[Any]    # findings present in both
    structural_changes: List[str]     # plain-language list of what changed in model structure
    remediation_recommendation: str   # "none" | "targeted" | "project"
    recommendation_label: str         # Human label
    recommendation_summary: str       # AI-written plain-language explanation
    critical_remaining: int
    high_remaining: int


# ── Scenarios ─────────────────────────────────────────────────────────────────

class ScenarioCreate(BaseModel):
    name: str = Field(..., example="PEP Customer — Low Transaction Volume")
    input_profile: dict = Field(..., example={"customer_type": "PEP", "geography": "EU"})


class ScenarioResponse(BaseModel):
    id: str
    model_version_id: str
    name: str
    source: str
    input_profile: dict
    computed_score: Optional[float]
    assigned_band: Optional[str]
    triggered_rules: List[Any]
    ai_assessment: str
    flagged_issues: List[Any]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Platform Settings ────────────────────────────────────────────────────────

class SettingsUpdate(BaseModel):
    anthropic_api_key: Optional[str] = None
    org_name: Optional[str] = None
    org_logo_url: Optional[str] = None
    regulatory_profile: Optional[List[str]] = None


class SettingsResponse(BaseModel):
    org_name: str
    org_logo_url: Optional[str]
    regulatory_profile: List[str]
    api_key_configured: bool   # True if key is set (value never returned to frontend)
    updated_at: Optional[Any]

    class Config:
        from_attributes = True


# ── Model Register ────────────────────────────────────────────────────────────

class ModelRegisterEntry(BaseModel):
    model_id: str
    model_version: str
    parse_status: str
    finding_count: int
    source_type: str
    created_at: Any
    project_id: str
    project_name: str
    institution: Optional[str]
    lifecycle_stage: str


# ── Scenarios ─────────────────────────────────────────────────────────────────

class ScenarioResponse(BaseModel):
    id: str
    model_version_id: str
    name: str
    source: str
    input_profile: dict
    computed_score: Optional[float]
    assigned_band: Optional[str]
    triggered_rules: List[Any]
    ai_assessment: str
    flagged_issues: List[Any]
    created_at: Any

    class Config:
        from_attributes = True


class ScenarioCreate(BaseModel):
    name: str = Field(..., example="PEP Customer — Low Transaction Volume")
    input_profile: dict = Field(..., example={"customer_type": "PEP", "geography": "EU"})


# ── General ──────────────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str


class ErrorResponse(BaseModel):
    detail: str
