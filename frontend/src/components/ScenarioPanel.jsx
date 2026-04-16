/**
 * ScenarioPanel
 * Three-mode scenario testing: AI-generated, manual builder, regulatory library.
 * Used as a tab inside ProjectDetail.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Sparkles, PenLine, BookOpen, Play, Trash2, RefreshCw,
  ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Info,
  Plus, X
} from 'lucide-react'
import {
  getScenarios, generateScenarios, createScenario,
  runLibraryScenario, deleteScenario, getScenarioLibrary,
} from '../api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function BandBadge({ band }) {
  if (!band) return <span className="text-xs text-gray-400">—</span>
  const colours = {
    'Very High': 'bg-red-100 text-red-800',
    'High':      'bg-orange-100 text-orange-800',
    'Medium':    'bg-yellow-100 text-yellow-700',
    'Low':       'bg-green-100 text-green-700',
  }
  const match = Object.entries(colours).find(([k]) => band.toLowerCase().includes(k.toLowerCase()))
  const cls = match ? match[1] : 'bg-gray-100 text-gray-600'
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${cls}`}>{band}</span>
}

function SourceBadge({ source }) {
  const map = {
    auto_generated: { label: 'AI Generated', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
    manual:         { label: 'Manual',        cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    library:        { label: 'Library',       cls: 'bg-teal/10 text-teal border-teal/30' },
  }
  const { label, cls } = map[source] || { label: source, cls: 'bg-gray-50 text-gray-600' }
  return <span className={`text-xs font-medium px-2 py-0.5 rounded border ${cls}`}>{label}</span>
}

function ScoreBar({ score }) {
  if (score == null) return null
  const pct = Math.min(Math.max(score, 0), 100)
  const colour = pct >= 80 ? 'bg-red-500' : pct >= 60 ? 'bg-orange-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${colour}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-600 w-10 text-right">{score.toFixed(0)}</span>
    </div>
  )
}

// ── Scenario result card ──────────────────────────────────────────────────────
function ScenarioCard({ scenario, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async e => {
    e.stopPropagation()
    if (!window.confirm('Delete this scenario?')) return
    setDeleting(true)
    try { await onDelete(scenario.id) } finally { setDeleting(false) }
  }

  const hasIssues = scenario.flagged_issues?.length > 0

  return (
    <div className={`card overflow-hidden border-l-4 ${
      hasIssues ? 'border-l-orange-400' : 'border-l-green-400'
    }`}>
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-sm text-navy">{scenario.name}</p>
            <SourceBadge source={scenario.source} />
            {hasIssues && (
              <span className="flex items-center gap-1 text-xs text-orange-600">
                <AlertTriangle size={11} /> {scenario.flagged_issues.length} issue{scenario.flagged_issues.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            <BandBadge band={scenario.assigned_band} />
            <div className="flex-1 max-w-xs">
              <ScoreBar score={scenario.computed_score} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-gray-300 hover:text-red-400 transition-colors p-1"
          >
            <Trash2 size={13} />
          </button>
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-4">
          {/* Input profile */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Customer Profile</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(scenario.input_profile || {}).map(([k, v]) => (
                <div key={k} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs">
                  <span className="text-gray-500">{k}:</span>{' '}
                  <span className="font-medium text-navy">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Triggered rules */}
          {scenario.triggered_rules?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Triggered Rules</p>
              <div className="space-y-1">
                {scenario.triggered_rules.map((r, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-orange-50 border border-orange-100 rounded px-3 py-1.5">
                    <AlertTriangle size={11} className="text-orange-500 mt-0.5 flex-shrink-0" />
                    <span className="text-orange-800">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI assessment */}
          {scenario.ai_assessment && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">AI Assessment</p>
              <p className="text-sm text-gray-700 leading-relaxed">{scenario.ai_assessment}</p>
            </div>
          )}

          {/* Flagged issues */}
          {hasIssues && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Flagged Issues</p>
              <div className="space-y-1">
                {scenario.flagged_issues.map((issue, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-red-50 border border-red-100 rounded px-3 py-1.5">
                    <X size={11} className="text-red-500 mt-0.5 flex-shrink-0" />
                    <span className="text-red-800">{issue}</span>
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

// ── Tab: AI Generate ──────────────────────────────────────────────────────────
function AiGenerateTab({ projectId, modelId, onScenarioAdded }) {
  const [generating, setGenerating] = useState(false)
  const [error, setError]           = useState(null)

  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    try {
      await generateScenarios(projectId, modelId)
      onScenarioAdded()
    } catch (e) {
      setError(e.response?.data?.detail || 'Generation failed. Check that the model is parsed and your API key is set.')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-purple-50 border border-purple-100 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Sparkles size={20} className="text-purple-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-purple-900 text-sm">AI Scenario Generation</p>
            <p className="text-sm text-purple-700 mt-1 leading-relaxed">
              Claude reads the parsed model structure and generates 10 edge-case scenarios
              targeting boundary conditions, regulatory mandatory profiles (PEP, sanctions,
              high-risk geographies), contradictory factor combinations, and over/under-classification risks.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {['Boundary conditions', 'PEP & sanctions', 'Contradictory profiles', 'Override triggers', 'Classification risks'].map(t => (
                <span key={t} className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={generating}
        className="btn-primary flex items-center gap-2"
      >
        {generating
          ? <><RefreshCw size={15} className="animate-spin" /> Generating — this takes ~30 seconds…</>
          : <><Sparkles size={15} /> Generate 10 AI Scenarios</>
        }
      </button>

      <p className="text-xs text-gray-400">
        Re-generating replaces any previously auto-generated scenarios.
        Manually created scenarios are not affected.
      </p>
    </div>
  )
}

// ── Tab: Manual Builder ───────────────────────────────────────────────────────
function ManualTab({ projectId, modelId, structured, onScenarioAdded }) {
  const [name, setName]     = useState('')
  const [profile, setProfile] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  // Extract risk factors from parsed model for dynamic form
  const factors = structured?.risk_factors || []

  // Free-form key-value pairs when no structured factors available
  const [freeFields, setFreeFields] = useState([{ key: '', value: '' }])

  const useDynamic = factors.length > 0

  const handleFactorChange = (factorName, value) => {
    setProfile(p => ({ ...p, [factorName]: value }))
  }

  const addFreeField = () => setFreeFields(f => [...f, { key: '', value: '' }])
  const updateFreeField = (i, field, val) => {
    setFreeFields(f => {
      const updated = [...f]
      updated[i] = { ...updated[i], [field]: val }
      return updated
    })
  }
  const removeFreeField = i => setFreeFields(f => f.filter((_, idx) => idx !== i))

  const buildProfile = () => {
    if (useDynamic) return profile
    return Object.fromEntries(
      freeFields.filter(f => f.key.trim()).map(f => [f.key.trim(), f.value])
    )
  }

  const handleRun = async () => {
    if (!name.trim()) { setError('Scenario name is required.'); return }
    const inputProfile = buildProfile()
    if (Object.keys(inputProfile).length === 0) { setError('Add at least one factor value.'); return }

    setSaving(true)
    setError(null)
    try {
      await createScenario(projectId, modelId, { name: name.trim(), input_profile: inputProfile })
      setName('')
      setProfile({})
      setFreeFields([{ key: '', value: '' }])
      onScenarioAdded()
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to run scenario.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-700">
        <div className="flex items-start gap-2">
          <Info size={15} className="flex-shrink-0 mt-0.5" />
          <p>
            {useDynamic
              ? `${factors.length} risk factors detected from the parsed model. Select a value for each factor to compute a score.`
              : 'No structured factors found. Enter factor names and values manually.'
            }
          </p>
        </div>
      </div>

      {/* Scenario name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Scenario name *</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. PEP Customer — Domestic, High Transactions"
          className="input"
        />
      </div>

      {/* Factor inputs */}
      {useDynamic ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Risk Factor Values</p>
          {factors.map(factor => {
            const valueLabels = factor.value_labels || []
            const weightDisplay = factor.weight
              ? (typeof factor.weight === 'number' && factor.weight <= 1
                  ? `${(factor.weight * 100).toFixed(0)}%`
                  : `${factor.weight}${typeof factor.weight === 'string' ? '' : '%'}`)
              : null

            return (
              <div key={factor.id || factor.name} className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-navy">{factor.name}</p>
                  {weightDisplay && (
                    <span className="text-xs text-teal font-medium">Weight: {weightDisplay}</span>
                  )}
                </div>
                {valueLabels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {valueLabels.map((vl, i) => {
                      const isSelected = profile[factor.name] === vl.label
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => handleFactorChange(factor.name, isSelected ? undefined : vl.label)}
                          className={`text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                            isSelected
                              ? 'bg-teal text-white border-teal'
                              : 'bg-white border-gray-200 text-gray-600 hover:border-teal/50 hover:text-teal'
                          }`}
                        >
                          {vl.label}
                          {vl.score != null && (
                            <span className={`ml-1.5 ${isSelected ? 'opacity-70' : 'text-gray-400'}`}>
                              ({vl.score})
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <input
                    value={profile[factor.name] || ''}
                    onChange={e => handleFactorChange(factor.name, e.target.value)}
                    placeholder="Enter value..."
                    className="input text-sm"
                  />
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Factor Values</p>
          {freeFields.map((field, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={field.key}
                onChange={e => updateFreeField(i, 'key', e.target.value)}
                placeholder="Factor name"
                className="input flex-1 text-sm"
              />
              <input
                value={field.value}
                onChange={e => updateFreeField(i, 'value', e.target.value)}
                placeholder="Value"
                className="input flex-1 text-sm"
              />
              {freeFields.length > 1 && (
                <button onClick={() => removeFreeField(i)} className="text-gray-400 hover:text-red-400">
                  <X size={14} />
                </button>
              )}
            </div>
          ))}
          <button onClick={addFreeField} className="flex items-center gap-1.5 text-sm text-teal hover:text-teal/80">
            <Plus size={13} /> Add factor
          </button>
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={saving}
        className="btn-primary flex items-center gap-2"
      >
        {saving
          ? <><RefreshCw size={15} className="animate-spin" /> Running scenario…</>
          : <><Play size={15} /> Run Scenario</>
        }
      </button>
    </div>
  )
}

// ── Tab: Regulatory Library ───────────────────────────────────────────────────
function LibraryTab({ projectId, modelId, onScenarioAdded }) {
  const [library, setLibrary]   = useState([])
  const [running, setRunning]   = useState({})
  const [expanded, setExpanded] = useState({})
  const [error, setError]       = useState(null)

  useEffect(() => {
    getScenarioLibrary().then(r => setLibrary(r.data))
  }, [])

  const handleRun = async (libId) => {
    setRunning(r => ({ ...r, [libId]: true }))
    setError(null)
    try {
      await runLibraryScenario(projectId, modelId, libId)
      onScenarioAdded()
    } catch (e) {
      setError(e.response?.data?.detail || `Failed to run ${libId}`)
    } finally {
      setRunning(r => ({ ...r, [libId]: false }))
    }
  }

  return (
    <div className="space-y-3">
      <div className="bg-teal/5 border border-teal/20 rounded-xl p-4 text-sm text-teal-900 mb-4">
        <div className="flex items-start gap-2">
          <BookOpen size={15} className="flex-shrink-0 mt-0.5 text-teal" />
          <p>
            Pre-built test scenarios based on FATF typologies and FFFS 2017:11 requirements.
            Click <strong>Run</strong> to score each template against your model and get an AI assessment.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {library.map(template => (
        <div key={template.id} className="card overflow-hidden">
          <div
            className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50"
            onClick={() => setExpanded(e => ({ ...e, [template.id]: !e[template.id] }))}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium text-sm text-navy">{template.name}</p>
                <span className="text-xs font-mono text-teal">{template.id}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
              <p className="text-xs text-blue-600 mt-1">{template.regulatory_basis}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={e => { e.stopPropagation(); handleRun(template.id) }}
                disabled={running[template.id]}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-teal text-white hover:bg-teal/90 font-medium transition-colors disabled:opacity-50"
              >
                {running[template.id]
                  ? <><RefreshCw size={11} className="animate-spin" /> Running…</>
                  : <><Play size={11} /> Run</>
                }
              </button>
              {expanded[template.id]
                ? <ChevronUp size={14} className="text-gray-400" />
                : <ChevronDown size={14} className="text-gray-400" />
              }
            </div>
          </div>

          {expanded[template.id] && (
            <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Input Profile</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(template.input_profile).map(([k, v]) => (
                    <div key={k} className="bg-white border border-gray-200 rounded px-2.5 py-1 text-xs">
                      <span className="text-gray-500">{k}:</span>{' '}
                      <span className="font-medium text-navy">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Expected Band</p>
                <p className="text-sm text-gray-700">{template.expected_band}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Test Purpose</p>
                <p className="text-sm text-gray-700">{template.test_purpose}</p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main ScenarioPanel ────────────────────────────────────────────────────────
export default function ScenarioPanel({ projectId, modelId, structured, parseStatus }) {
  const [mode, setMode]         = useState('results') // 'results' | 'generate' | 'manual' | 'library'
  const [scenarios, setScenarios] = useState([])
  const [loading, setLoading]   = useState(true)

  const loadScenarios = useCallback(() => {
    if (!modelId) return
    setLoading(true)
    getScenarios(projectId, modelId)
      .then(r => setScenarios(r.data))
      .finally(() => setLoading(false))
  }, [projectId, modelId])

  useEffect(() => { loadScenarios() }, [loadScenarios])

  const handleDelete = async (id) => {
    await deleteScenario(id)
    loadScenarios()
  }

  const handleAdded = () => {
    loadScenarios()
    setMode('results')
  }

  if (parseStatus !== 'parsed') {
    return (
      <div className="card p-8 text-center">
        <Info size={24} className="text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">Scenarios are available once the model has been parsed.</p>
        <p className="text-xs text-gray-400 mt-1">Current status: <strong>{parseStatus}</strong></p>
      </div>
    )
  }

  const tabs = [
    { key: 'results',  icon: <CheckCircle size={13} />, label: `Results${scenarios.length > 0 ? ` (${scenarios.length})` : ''}` },
    { key: 'generate', icon: <Sparkles size={13} />,    label: 'AI Generate' },
    { key: 'manual',   icon: <PenLine size={13} />,     label: 'Manual' },
    { key: 'library',  icon: <BookOpen size={13} />,    label: 'Library' },
  ]

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(({ key, icon, label }) => (
          <button
            key={key}
            onClick={() => setMode(key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-colors ${
              mode === key
                ? 'bg-white text-navy shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {mode === 'results' && (
        loading ? (
          <div className="text-sm text-gray-400 py-6">Loading scenarios…</div>
        ) : scenarios.length === 0 ? (
          <div className="card p-8 text-center space-y-3">
            <p className="text-gray-500 text-sm font-medium">No scenarios yet</p>
            <p className="text-gray-400 text-xs">
              Use <strong>AI Generate</strong> to auto-create edge-case tests,
              <strong> Manual</strong> to define your own, or
              <strong> Library</strong> to use regulatory templates.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button onClick={() => setMode('generate')} className="btn-primary text-sm flex items-center gap-2">
                <Sparkles size={13} /> AI Generate
              </button>
              <button onClick={() => setMode('library')} className="btn-secondary text-sm flex items-center gap-2">
                <BookOpen size={13} /> Browse Library
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Summary bar */}
            <div className="flex items-center gap-4 mb-3 flex-wrap">
              {['Very High', 'High', 'Medium', 'Low'].map(band => {
                const count = scenarios.filter(s => s.assigned_band?.toLowerCase().includes(band.toLowerCase())).length
                return count > 0 ? (
                  <div key={band} className="flex items-center gap-1.5">
                    <BandBadge band={band} />
                    <span className="text-xs text-gray-500">{count}</span>
                  </div>
                ) : null
              })}
              <span className="text-gray-300 text-xs">|</span>
              <span className="text-xs text-gray-500">
                {scenarios.filter(s => s.flagged_issues?.length > 0).length} with issues
              </span>
              <button
                onClick={() => setMode('generate')}
                className="ml-auto flex items-center gap-1.5 text-xs text-purple-600 hover:text-purple-800 font-medium"
              >
                <RefreshCw size={11} /> Regenerate
              </button>
            </div>
            {scenarios.map(s => (
              <ScenarioCard key={s.id} scenario={s} onDelete={handleDelete} />
            ))}
          </div>
        )
      )}

      {mode === 'generate' && (
        <AiGenerateTab projectId={projectId} modelId={modelId} onScenarioAdded={handleAdded} />
      )}

      {mode === 'manual' && (
        <ManualTab
          projectId={projectId}
          modelId={modelId}
          structured={structured}
          onScenarioAdded={handleAdded}
        />
      )}

      {mode === 'library' && (
        <LibraryTab projectId={projectId} modelId={modelId} onScenarioAdded={handleAdded} />
      )}
    </div>
  )
}
