/**
 * API client — all calls to the Valtior backend go through here.
 * Base URL is proxied by Vite in development (see vite.config.js).
 */
import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// ── Projects ─────────────────────────────────────────────────────────────────
export const getProjects    = ()           => api.get('/projects/')
export const createProject  = (data)       => api.post('/projects/', data)
export const getProject     = (id)         => api.get(`/projects/${id}`)
export const updateProject  = (id, data)   => api.patch(`/projects/${id}`, data)
export const deleteProject  = (id)         => api.delete(`/projects/${id}`)

// ── Models ────────────────────────────────────────────────────────────────────
export const getModels   = (projectId)         => api.get(`/projects/${projectId}/models/`)
export const uploadModel = (projectId, data)   => api.post(`/projects/${projectId}/models/`, data)
export const getModel    = (projectId, modelId)=> api.get(`/projects/${projectId}/models/${modelId}`)

export const uploadModelFile = (projectId, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/projects/${projectId}/models/upload-file`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

export const retryModel = (projectId, modelId) =>
  api.post(`/projects/${projectId}/models/${modelId}/retry`)

export const saveOpinion = (projectId, modelId, opinion) =>
  api.patch(`/projects/${projectId}/models/${modelId}/opinion`, { validation_opinion: opinion })

// ── Impact Analysis ───────────────────────────────────────────────────────────
export const portfolioTemplateUrl = (projectId, modelId) =>
  `/api/v1/projects/${projectId}/models/${modelId}/portfolio-template`

export const runImpactAnalysis = (projectId, fromModelId, toModelId, portfolioFile) => {
  const form = new FormData()
  form.append('from_model_id', fromModelId)
  form.append('to_model_id',   toModelId)
  form.append('portfolio',     portfolioFile)
  return api.post(`/projects/${projectId}/impact/analyse`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
}

// ── Remediation ───────────────────────────────────────────────────────────────
export const updateRemediation      = (findingId, data) =>
  api.patch(`/findings/${findingId}/remediate`, data)

export const getRemediationSummary  = (projectId, modelId) =>
  api.get(`/projects/${projectId}/models/${modelId}/remediation-summary`)

export const getOverdueAcrossProjects = () =>
  api.get('/remediation/overdue')

export const compareVersions        = (projectId, fromId, toId) =>
  api.get(`/projects/${projectId}/versions/compare?from_id=${fromId}&to_id=${toId}`)

// ── Admin / Settings ──────────────────────────────────────────────────────────
export const getSettings    = ()       => api.get('/admin/settings')
export const updateSettings = (data)   => api.patch('/admin/settings', data)
export const getModelRegister = ()     => api.get('/admin/model-register')

// ── Scenarios ─────────────────────────────────────────────────────────────────
export const getScenarios        = (projectId, modelId) =>
  api.get(`/projects/${projectId}/models/${modelId}/scenarios/`)

export const createScenario      = (projectId, modelId, data) =>
  api.post(`/projects/${projectId}/models/${modelId}/scenarios/`, data)

export const generateScenarios   = (projectId, modelId) =>
  api.post(`/projects/${projectId}/models/${modelId}/scenarios/generate`)

export const runLibraryScenario  = (projectId, modelId, libId) =>
  api.post(`/projects/${projectId}/models/${modelId}/scenarios/library/${libId}`)

export const deleteScenario      = (scenarioId) =>
  api.delete(`/scenarios/${scenarioId}`)

export const getScenarioLibrary  = () =>
  api.get('/scenarios/library')

// ── Findings ──────────────────────────────────────────────────────────────────
export const getFindings     = (modelId)           => api.get(`/findings/model/${modelId}`)
export const annotateFinding = (findingId, data)   => api.patch(`/findings/${findingId}/annotate`, data)

// ── Compliance & Reports ──────────────────────────────────────────────────────
export const getComplianceMatrix = (projectId, modelId) =>
  api.get(`/projects/${projectId}/models/${modelId}/compliance`)

// Report downloads open as a direct browser URL (triggers file download)
export const reportPdfUrl  = (projectId, modelId) =>
  `/api/v1/projects/${projectId}/models/${modelId}/report/pdf`

export const reportPptxUrl = (projectId, modelId) =>
  `/api/v1/projects/${projectId}/models/${modelId}/report/pptx`

export default api
