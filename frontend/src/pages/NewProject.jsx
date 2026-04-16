import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield } from 'lucide-react'
import { createProject } from '../api'

// SIMPT 7-phase model lifecycle
const LIFECYCLE_STAGES = [
  { value: 'initiering',          label: '1 — Initiering',             description: 'Model concept defined; scope and purpose agreed' },
  { value: 'modellutveckling',    label: '2 — Modellutveckling',       description: 'Risk factors, weights, and logic being developed' },
  { value: 'implementation',      label: '3 — Implementation & test',  description: 'Model built and undergoing pre-launch testing' },
  { value: 'validering',          label: '4 — Validering',             description: 'Independent validation underway — most common entry point' },
  { value: 'modellanvandande',    label: '5 — Modellanvändande',       description: 'Model live and in production use' },
  { value: 'modelluppfoljning',   label: '6 — Modelluppföljning',      description: 'Ongoing performance monitoring against benchmarks' },
  { value: 'lopande_validering',  label: '7 — Löpande validering',     description: 'Periodic re-validation triggered by time or material change' },
]

export default function NewProject() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    domain: 'AML_KYC',
    owner: '',
    institution: '',
    notes: '',
    lifecycle_stage: 'validering',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const handleChange = e => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const { data } = await createProject(form)
      navigate(`/projects/${data.id}`)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create project. Is the backend running?')
      setSaving(false)
    }
  }

  const selectedStage = LIFECYCLE_STAGES.find(s => s.value === form.lifecycle_stage)

  return (
    <div className="p-8 max-w-2xl">
      {/* Back */}
      <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft size={15} />
        Back to projects
      </button>

      <div className="flex items-center gap-3 mb-6">
        <div className="bg-teal p-2.5 rounded-lg">
          <Shield size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-navy">New Validation Project</h1>
          <p className="text-sm text-gray-500">Set up a new model validation engagement</p>
        </div>
      </div>

      <div className="card p-6">
        <form onSubmit={handleSubmit} className="space-y-5">

          <div>
            <label className="label">Project name *</label>
            <input
              name="name" value={form.name} onChange={handleChange}
              className="input" required
              placeholder="e.g. Bank X — Customer Risk Scoring Model Q2 2026"
            />
            <p className="text-xs text-gray-400 mt-1">Use a descriptive name you'll recognise in months.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Domain</label>
              <select name="domain" value={form.domain} onChange={handleChange} className="input">
                <option value="AML_KYC">AML / KYC</option>
                <option value="TM">Transaction Monitoring</option>
                <option value="FRAUD">Fraud</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Institution / Client</label>
              <input
                name="institution" value={form.institution} onChange={handleChange}
                className="input" placeholder="e.g. First National Bank"
              />
            </div>
          </div>

          <div>
            <label className="label">Model owner / team</label>
            <input
              name="owner" value={form.owner} onChange={handleChange}
              className="input" placeholder="e.g. Compliance & AML Team"
            />
          </div>

          {/* Lifecycle stage — SIMPT 7-phase model */}
          <div>
            <label className="label">Model lifecycle stage</label>
            <select name="lifecycle_stage" value={form.lifecycle_stage} onChange={handleChange} className="input">
              {LIFECYCLE_STAGES.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            {selectedStage && (
              <p className="text-xs text-gray-400 mt-1">{selectedStage.description}</p>
            )}
            <p className="text-xs text-teal mt-1">Based on SIMPT model lifecycle (Vägledning modellriskhantering, 2024)</p>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              name="notes" value={form.notes} onChange={handleChange}
              className="input h-24 resize-none"
              placeholder="Optional context — e.g. scope, regulatory trigger, review deadline, material changes since last validation"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || !form.name} className="btn-primary">
              {saving ? 'Creating…' : 'Create project'}
            </button>
            <button type="button" onClick={() => navigate('/')} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
