/**
 * ImpactPanel — Portfolio Impact Analysis
 *
 * When a model changes, this panel lets the user upload an anonymised
 * customer portfolio and see exactly which customers change risk band,
 * what regulatory obligations each band movement triggers, and whether
 * the changes warrant a formal remediation project (EDD), a targeted sprint,
 * or routine handling.
 */

import { useState, useEffect } from 'react'
import {
  Upload, Download, RefreshCw, AlertTriangle, CheckCircle,
  ChevronDown, ChevronUp, Users, ArrowRight, FileText, Info,
} from 'lucide-react'
import { portfolioTemplateUrl, runImpactAnalysis } from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function UrgencyBadge({ urgency, label }) {
  const colours = {
    critical: 'bg-red-100 text-red-800 border-red-300',
    high:     'bg-orange-100 text-orange-700 border-orange-300',
    medium:   'bg-yellow-100 text-yellow-700 border-yellow-300',
    low:      'bg-blue-50 text-blue-700 border-blue-200',
    none:     'bg-gray-50 text-gray-500 border-gray-200',
  }
  return (
    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${colours[urgency] || colours.none}`}>
      {label}
    </span>
  )
}

function RecBanner({ recommendation, label, summary }) {
  const styles = {
    project:  { bg: 'bg-red-50 border-red-300',    text: 'text-red-800',    icon: '⚠', title: 'Formal Remediation Project Required' },
    targeted: { bg: 'bg-orange-50 border-orange-300', text: 'text-orange-800', icon: '→', title: 'Targeted Remediation Sprint' },
    none:     { bg: 'bg-green-50 border-green-300', text: 'text-green-800', icon: '✓', title: 'No Formal Action Required' },
  }
  const s = styles[recommendation] || styles.none
  return (
    <div className={`border rounded-xl p-5 ${s.bg}`}>
      <div className="flex items-start gap-3">
        <span className={`text-2xl font-bold ${s.text} leading-none mt-0.5`}>{s.icon}</span>
        <div>
          <p className={`font-bold text-sm ${s.text}`}>{label || s.title}</p>
          <p className={`text-sm mt-2 leading-relaxed ${s.text}`}>{summary}</p>
        </div>
      </div>
    </div>
  )
}

// ── Band movement matrix ──────────────────────────────────────────────────────
function MovementMatrix({ matrix }) {
  const entries = Object.entries(matrix).filter(([, v]) => v > 0)
  if (!entries.length) return null

  const escalations   = entries.filter(([k]) => !k.includes('→') || k.split(' → ')[0] !== k.split(' → ')[1])
  const unchanged     = entries.filter(([k]) => { const [a,b] = k.split(' → '); return a === b })

  const bandOrder = ['Low', 'Medium', 'High', 'Very High', 'Unknown']
  const bandColour = band => {
    const b = (band || '').toLowerCase()
    if (b.includes('very') || b.includes('critical')) return 'bg-red-100 text-red-800'
    if (b.includes('high'))   return 'bg-orange-100 text-orange-700'
    if (b.includes('medium')) return 'bg-yellow-100 text-yellow-700'
    if (b.includes('low'))    return 'bg-green-100 text-green-700'
    return 'bg-gray-100 text-gray-600'
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Band Movement Breakdown</p>
      </div>
      <div className="divide-y divide-gray-50">
        {entries
          .sort((a, b) => b[1] - a[1])
          .map(([movement, count]) => {
            const [fromBand, toBand] = movement.split(' → ')
            const isEscalation = fromBand !== toBand && bandOrder.indexOf(toBand) > bandOrder.indexOf(fromBand)
            const isDeescalation = fromBand !== toBand && bandOrder.indexOf(toBand) < bandOrder.indexOf(fromBand)
            const isUnchanged = fromBand === toBand
            return (
              <div key={movement} className="flex items-center gap-3 px-5 py-3">
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${bandColour(fromBand)}`}>{fromBand}</span>
                <ArrowRight size={13} className={
                  isEscalation ? 'text-red-400' : isDeescalation ? 'text-green-500' : 'text-gray-300'
                } />
                <span className={`text-xs font-medium px-2 py-0.5 rounded ${bandColour(toBand)}`}>{toBand}</span>
                <div className="flex-1" />
                <span className="text-sm font-bold text-navy">{count.toLocaleString()}</span>
                <span className="text-xs text-gray-400">customers</span>
                {isEscalation && <span className="text-xs text-red-500">↑ escalation</span>}
                {isDeescalation && <span className="text-xs text-green-600">↓ de-escalation</span>}
                {isUnchanged && <span className="text-xs text-gray-400">no change</span>}
              </div>
            )
          })
        }
      </div>
    </div>
  )
}

// ── Action groups ─────────────────────────────────────────────────────────────
const ACTION_LABELS = {
  edd_project:        'Enhanced Due Diligence (EDD)',
  edd_update:         'EDD Update Required',
  cdd_review:         'CDD Review',
  periodic_review:    'Periodic Review',
  deescalation_review:'De-escalation Review',
  review:             'Review Required',
}

function ActionGroups({ groups }) {
  const [expanded, setExpanded] = useState({})
  const entries = Object.entries(groups || {})
  if (!entries.length) return null

  const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3, none: 4 }
  entries.sort((a, b) => (urgencyOrder[a[1].urgency] || 4) - (urgencyOrder[b[1].urgency] || 4))

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Required Actions by Group</p>
      {entries.map(([atype, group]) => (
        <div key={atype} className="card overflow-hidden">
          <div
            className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50"
            onClick={() => setExpanded(e => ({ ...e, [atype]: !e[atype] }))}
          >
            <Users size={16} className="text-navy flex-shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm text-navy">{ACTION_LABELS[atype] || atype}</p>
                <UrgencyBadge urgency={group.urgency} label={group.urgency_label} />
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{group.obligation}</p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <div className="text-right">
                <p className="text-xl font-bold text-navy">{group.count.toLocaleString()}</p>
                <p className="text-xs text-gray-400">customers</p>
              </div>
              {expanded[atype] ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
            </div>
          </div>

          {expanded[atype] && (
            <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Timeline</p>
                  <p className="text-gray-700">{group.timeline}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Regulatory Basis</p>
                  <p className="text-teal text-xs font-medium">{group.law}</p>
                </div>
              </div>
              {group.sample_customers?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    Sample customers ({group.sample_customers.length} shown)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.sample_customers.map(ref => (
                      <span key={ref} className="text-xs bg-white border border-gray-200 rounded px-2 py-0.5 font-mono text-gray-600">
                        {ref}
                      </span>
                    ))}
                    {group.count > group.sample_customers.length && (
                      <span className="text-xs text-gray-400 px-2 py-0.5">
                        +{(group.count - group.sample_customers.length).toLocaleString()} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function ImpactPanel({ projectId, versions }) {
  const parsedVersions = (versions || []).filter(v => v.parse_status === 'parsed')

  const [fromId,   setFromId]   = useState('')
  const [toId,     setToId]     = useState('')
  const [file,     setFile]     = useState(null)
  const [dragging, setDragging] = useState(false)
  const [running,  setRunning]  = useState(false)
  const [result,   setResult]   = useState(null)
  const [error,    setError]    = useState(null)

  // Auto-select oldest → newest
  useEffect(() => {
    if (parsedVersions.length >= 2) {
      setFromId(parsedVersions[parsedVersions.length - 1].id)
      setToId(parsedVersions[0].id)
    } else if (parsedVersions.length === 1) {
      setFromId(parsedVersions[0].id)
      setToId(parsedVersions[0].id)
    }
  }, [versions])

  const handleDrop = e => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f && f.name.endsWith('.csv')) { setFile(f); setError(null) }
    else setError('Only CSV files are accepted. Download the template below.')
  }

  const handleRun = async () => {
    if (!fromId || !toId) { setError('Select both model versions.'); return }
    if (fromId === toId)  { setError('Select two different model versions.'); return }
    if (!file)            { setError('Upload a portfolio CSV file.'); return }
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const r = await runImpactAnalysis(projectId, fromId, toId, file)
      setResult(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Analysis failed. Check the file format and try again.')
    } finally {
      setRunning(false)
    }
  }

  if (parsedVersions.length < 1) {
    return (
      <div className="card p-8 text-center text-gray-400 text-sm">
        <Info size={22} className="mx-auto mb-2 text-gray-300" />
        <p className="font-medium">Upload and parse a model first</p>
        <p className="text-xs mt-1">Impact analysis requires at least one parsed model version.</p>
      </div>
    )
  }

  const templateModelId = toId || fromId || parsedVersions[0]?.id

  return (
    <div className="space-y-5">
      {/* How it works */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-blue-800">
            <p className="font-semibold mb-1">How portfolio impact analysis works</p>
            <p className="text-xs leading-relaxed">
              Upload an anonymised customer file (no PII — just a reference number and factor values).
              The system re-scores every customer under both model versions, identifies who changes band,
              maps each movement to its regulatory obligation under PTL and FFFS 2017:11, and produces
              an action plan telling you exactly what needs to happen and whether it warrants a
              formal remediation project.
            </p>
          </div>
        </div>
      </div>

      {/* Config card */}
      <div className="card p-5 space-y-4">
        {/* Version selectors */}
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Model Versions</p>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-40">
              <label className="block text-xs text-gray-500 mb-1">From (older)</label>
              <select value={fromId} onChange={e => setFromId(e.target.value)} className="input text-sm">
                <option value="">Select…</option>
                {parsedVersions.map(v => (
                  <option key={v.id} value={v.id}>v{v.version} — {new Date(v.created_at).toLocaleDateString('en-GB')}</option>
                ))}
              </select>
            </div>
            <ArrowRight size={16} className="text-gray-400 mt-5 flex-shrink-0" />
            <div className="flex-1 min-w-40">
              <label className="block text-xs text-gray-500 mb-1">To (newer)</label>
              <select value={toId} onChange={e => setToId(e.target.value)} className="input text-sm">
                <option value="">Select…</option>
                {parsedVersions.map(v => (
                  <option key={v.id} value={v.id}>v{v.version} — {new Date(v.created_at).toLocaleDateString('en-GB')}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Portfolio upload */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer Portfolio (CSV)</p>
            {templateModelId && (
              <a
                href={portfolioTemplateUrl(projectId, templateModelId)}
                className="flex items-center gap-1.5 text-xs text-teal hover:underline"
              >
                <Download size={11} /> Download template
              </a>
            )}
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => document.getElementById('portfolio-input').click()}
            className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              dragging ? 'border-teal bg-teal/5' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            <input
              id="portfolio-input"
              type="file"
              accept=".csv"
              onChange={e => { const f = e.target.files[0]; if (f) { setFile(f); setError(null) } }}
              className="hidden"
            />
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileText size={18} className="text-teal" />
                <div className="text-left">
                  <p className="text-sm font-medium text-navy">{file.name}</p>
                  <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB ready</p>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setFile(null) }}
                  className="ml-3 text-xs text-gray-400 hover:text-red-400"
                >
                  Remove
                </button>
              </div>
            ) : (
              <>
                <Upload size={20} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500 font-medium">Drop portfolio CSV here or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">
                  First column = customer reference. Remaining columns = factor values.
                  Download the template above to get the exact column headers.
                </p>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <button
          onClick={handleRun}
          disabled={running || !file || !fromId || !toId}
          className="btn-primary flex items-center gap-2"
        >
          {running
            ? <><RefreshCw size={15} className="animate-spin" /> Analysing portfolio…</>
            : <><Users size={15} /> Run Impact Analysis</>
          }
        </button>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          {/* Key stats */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'Total Customers', value: result.total_customers.toLocaleString(), sub: 'in portfolio', colour: 'text-navy' },
              { label: 'Band Changes',    value: result.changed_customers.toLocaleString(), sub: `${result.total_customers ? Math.round(result.changed_customers/result.total_customers*100) : 0}% of portfolio`, colour: 'text-orange-600' },
              { label: 'EDD Required',    value: result.edd_required.toLocaleString(), sub: 'immediate action', colour: result.edd_required > 0 ? 'text-red-700' : 'text-gray-500' },
              { label: 'No Change',       value: result.unchanged_customers.toLocaleString(), sub: 'band unchanged', colour: 'text-green-700' },
            ].map(({ label, value, sub, colour }) => (
              <div key={label} className="card p-4 text-center">
                <p className={`text-2xl font-bold ${colour}`}>{value}</p>
                <p className="text-xs font-medium text-gray-500 mt-0.5">{label}</p>
                <p className="text-xs text-gray-400">{sub}</p>
              </div>
            ))}
          </div>

          {/* AI recommendation */}
          <RecBanner
            recommendation={result.recommendation}
            label={result.recommendation_label}
            summary={result.ai_action_plan}
          />

          {/* Band movement matrix */}
          <MovementMatrix matrix={result.band_movement_matrix} />

          {/* Action groups */}
          <ActionGroups groups={result.action_groups} />

          {/* Customer detail table — first 50 rows */}
          {result.customer_movements?.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Customer Detail
                </p>
                <span className="text-xs text-gray-400">
                  {result.movements_truncated
                    ? `First 500 of ${result.total_customers.toLocaleString()} customers`
                    : `${result.customer_movements.length} customers`}
                </span>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500">Customer Ref</th>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500">From Band</th>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500">To Band</th>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500">Action</th>
                      <th className="text-left px-4 py-2 font-semibold text-gray-500">Timeline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {result.customer_movements
                      .filter(m => m.changed)
                      .slice(0, 50)
                      .map((m, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-gray-700">{m.customer_ref}</td>
                          <td className="px-4 py-2 text-gray-500">{m.band_old}</td>
                          <td className="px-4 py-2 font-medium text-navy">{m.band_new}</td>
                          <td className="px-4 py-2">
                            <UrgencyBadge urgency={m.urgency} label={m.urgency_label} />
                          </td>
                          <td className="px-4 py-2 text-gray-500">{m.law}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {result.customer_movements.filter(m => m.changed).length === 0 && (
                  <p className="text-center text-gray-400 text-sm py-6">No customers changed band.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
