/**
 * ConfiguratorPanel — Superadmin "what-if" model parameter editor.
 *
 * Lets a privileged user edit the parsed model's risk factor weights,
 * band thresholds, and triggers, then re-runs portfolio impact analysis
 * to see whether the change is material enough to require a formal
 * remediation project, a targeted sprint, or routine handling.
 *
 * The edits are NOT persisted to the model — purely a simulation.
 */

import { useState, useMemo } from 'react'
import {
  Settings2, RotateCcw, Upload, RefreshCw, AlertTriangle, Plus, Trash2, Download, Info,
} from 'lucide-react'
import { runWhatIfSimulation, portfolioTemplateUrl } from '../api'

// ── Recommendation banner (mirrors ImpactPanel style) ─────────────────────────
function RecBanner({ recommendation, label, summary }) {
  const styles = {
    project:  { bg: 'bg-red-50 border-red-300',       text: 'text-red-800',    icon: '⚠' },
    targeted: { bg: 'bg-orange-50 border-orange-300', text: 'text-orange-800', icon: '→' },
    none:     { bg: 'bg-green-50 border-green-300',   text: 'text-green-800',  icon: '✓' },
  }
  const s = styles[recommendation] || styles.none
  return (
    <div className={`border rounded-xl p-5 ${s.bg}`}>
      <div className="flex items-start gap-3">
        <span className={`text-2xl font-bold ${s.text} leading-none mt-0.5`}>{s.icon}</span>
        <div>
          <p className={`font-bold text-sm ${s.text}`}>{label}</p>
          <p className={`text-sm mt-2 leading-relaxed ${s.text}`}>{summary}</p>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const toNumberOrZero = (v) => {
  const n = parseFloat(v)
  return isNaN(n) ? 0 : n
}

function deepClone(o) { return JSON.parse(JSON.stringify(o || {})) }

// ── Main panel ────────────────────────────────────────────────────────────────
export default function ConfiguratorPanel({ projectId, modelId, structured, parseStatus, modelVersion }) {
  const original = useMemo(() => deepClone(structured || {}), [structured])
  const [edited, setEdited]     = useState(() => deepClone(structured || {}))
  const [portfolio, setPortfolio] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [running, setRunning]   = useState(false)
  const [error, setError]       = useState(null)
  const [result, setResult]     = useState(null)

  if (parseStatus !== 'parsed') {
    return (
      <div className="card p-8 text-center text-gray-400 text-sm">
        Configurator is only available once a model has been parsed.
      </div>
    )
  }
  if (!structured) {
    return (
      <div className="card p-8 text-center text-gray-400 text-sm">
        No structured parameters available for this model.
      </div>
    )
  }

  const factors  = edited.risk_factors || []
  const bands    = edited.bands || []
  const triggers = edited.triggers || []

  // Weight sum (with format normalisation — supports "25%" or 0.25 or 25)
  const weightSum = factors.reduce((s, f) => {
    const w = f.weight
    if (typeof w === 'string')      return s + parseFloat(w.replace('%', ''))
    if (typeof w === 'number' && w <= 1) return s + w * 100
    if (typeof w === 'number')      return s + w
    return s
  }, 0)

  // ── Mutators ────────────────────────────────────────────────────────────────
  const updateFactor = (i, field, val) => {
    setEdited(e => {
      const next = deepClone(e)
      next.risk_factors[i] = { ...next.risk_factors[i], [field]: val }
      return next
    })
  }
  const updateBand = (i, field, val) => {
    setEdited(e => {
      const next = deepClone(e)
      next.bands[i] = { ...next.bands[i], [field]: field.includes('score') ? toNumberOrZero(val) : val }
      return next
    })
  }
  const updateTrigger = (i, field, val) => {
    setEdited(e => {
      const next = deepClone(e)
      next.triggers[i] = { ...next.triggers[i], [field]: val }
      return next
    })
  }
  const addTrigger = () => {
    setEdited(e => {
      const next = deepClone(e)
      next.triggers = [...(next.triggers || []), { condition: '', action: '' }]
      return next
    })
  }
  const removeTrigger = (i) => {
    setEdited(e => {
      const next = deepClone(e)
      next.triggers = next.triggers.filter((_, idx) => idx !== i)
      return next
    })
  }
  const reset = () => { setEdited(deepClone(original)); setResult(null); setError(null) }

  // ── File handlers ───────────────────────────────────────────────────────────
  const onDrop = (e) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) { setPortfolio(f); setError(null) }
  }
  const onFile = (e) => {
    const f = e.target.files[0]
    if (f) { setPortfolio(f); setError(null) }
  }

  // ── Simulate ────────────────────────────────────────────────────────────────
  const simulate = async () => {
    if (!portfolio) { setError('Upload a portfolio CSV to simulate against.'); return }
    setRunning(true); setError(null); setResult(null)
    try {
      const r = await runWhatIfSimulation(projectId, modelId, edited, portfolio)
      setResult(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Simulation failed.')
    } finally {
      setRunning(false)
    }
  }

  const dirty = JSON.stringify(edited) !== JSON.stringify(original)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Settings2 size={20} className="text-teal mt-0.5" />
            <div>
              <h3 className="font-semibold text-navy text-sm">Model Parameter Configurator</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                Edit weights, band thresholds, and triggers, then simulate against a portfolio.
                Changes are not saved — they're only used for the what-if analysis below.
              </p>
            </div>
          </div>
          {dirty && (
            <button onClick={reset} className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0">
              <RotateCcw size={11} /> Reset to original
            </button>
          )}
        </div>
      </div>

      {/* Risk Factors */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Risk Factors & Weights</p>
          <span className={`text-xs font-medium ${Math.round(weightSum) === 100 ? 'text-green-700' : 'text-orange-700'}`}>
            Σ weights = {weightSum.toFixed(1)}%
            {Math.round(weightSum) !== 100 && ' — should sum to 100%'}
          </span>
        </div>
        {factors.length === 0 ? (
          <div className="px-5 py-4 text-sm text-gray-400">No risk factors in this model.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Factor</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 w-32">Weight</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Values</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {factors.map((f, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5">
                    <input
                      value={f.name || ''}
                      onChange={e => updateFactor(i, 'name', e.target.value)}
                      className="input text-sm font-medium"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <input
                      value={f.weight ?? ''}
                      onChange={e => updateFactor(i, 'weight', e.target.value)}
                      placeholder="e.g. 25 or 25%"
                      className="input text-sm"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {(f.value_labels || []).map(v => `${v.label}=${v.score}`).join(' · ') || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Bands */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Risk Bands</p>
        </div>
        {bands.length === 0 ? (
          <div className="px-5 py-4 text-sm text-gray-400">No bands defined.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Band Name</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 w-28">Min Score</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 w-28">Max Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {bands.map((b, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5">
                    <input value={b.name || ''} onChange={e => updateBand(i, 'name', e.target.value)} className="input text-sm" />
                  </td>
                  <td className="px-4 py-2.5">
                    <input type="number" value={b.min_score ?? 0} onChange={e => updateBand(i, 'min_score', e.target.value)} className="input text-sm" />
                  </td>
                  <td className="px-4 py-2.5">
                    <input type="number" value={b.max_score ?? 0} onChange={e => updateBand(i, 'max_score', e.target.value)} className="input text-sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Triggers */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Trigger Rules</p>
          <button onClick={addTrigger} className="text-xs text-teal hover:underline flex items-center gap-1">
            <Plus size={11} /> Add trigger
          </button>
        </div>
        {triggers.length === 0 ? (
          <div className="px-5 py-4 text-sm text-gray-400">No trigger rules. Add one to override scoring.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Condition</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500">Action</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {triggers.map((t, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5">
                    <input value={t.condition || ''} onChange={e => updateTrigger(i, 'condition', e.target.value)}
                      placeholder="e.g. PEP customer" className="input text-sm" />
                  </td>
                  <td className="px-4 py-2.5">
                    <input value={t.action || ''} onChange={e => updateTrigger(i, 'action', e.target.value)}
                      placeholder="e.g. Override to Very High" className="input text-sm" />
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button onClick={() => removeTrigger(i)} className="text-gray-400 hover:text-red-500">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Portfolio + Simulate */}
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Simulate Against Portfolio</p>
            <p className="text-xs text-gray-500 mt-1">
              Upload a portfolio CSV to score every customer under both the original and edited parameters.
            </p>
          </div>
          <a
            href={portfolioTemplateUrl(projectId, modelId)}
            className="btn-secondary text-xs flex items-center gap-1.5 flex-shrink-0"
          >
            <Download size={11} /> Template
          </a>
        </div>

        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => document.getElementById('whatif-file').click()}
          className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-3 ${
            dragging ? 'border-teal bg-teal/5' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
          }`}
        >
          <input id="whatif-file" type="file" accept=".csv" onChange={onFile} className="hidden" />
          {portfolio ? (
            <div className="text-sm text-navy font-medium">
              {portfolio.name} <span className="text-gray-400 font-normal text-xs">({(portfolio.size/1024).toFixed(0)} KB)</span>
            </div>
          ) : (
            <>
              <Upload size={20} className="text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500 font-medium">Drop CSV here or click to browse</p>
            </>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg mb-3 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}

        <button onClick={simulate} disabled={running || !portfolio} className="btn-primary flex items-center gap-2">
          {running
            ? <><RefreshCw size={14} className="animate-spin" /> Running simulation…</>
            : <>Run What-If Simulation</>
          }
        </button>
        {!dirty && (
          <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
            <Info size={11} /> No edits yet — simulation will report no impact.
          </p>
        )}
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <RecBanner
            recommendation={result.recommendation}
            label={result.recommendation_label}
            summary={result.ai_action_plan}
          />

          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total customers', value: result.total_customers, color: 'text-navy' },
              { label: 'Changed band',    value: result.changed_customers, color: 'text-orange-700' },
              { label: 'Unchanged',       value: result.unchanged_customers, color: 'text-gray-600' },
              { label: 'EDD required',    value: result.edd_required, color: result.edd_required > 0 ? 'text-red-700' : 'text-gray-600' },
            ].map(s => (
              <div key={s.label} className="card p-4">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          {Object.keys(result.band_movement_matrix || {}).length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Band Movements</p>
              </div>
              <div className="divide-y divide-gray-50">
                {Object.entries(result.band_movement_matrix)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div key={k} className="px-5 py-2.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700">{k}</span>
                      <span className="font-semibold text-navy">{v}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
