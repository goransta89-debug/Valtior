import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Upload, RefreshCw, CheckCircle, XCircle, Flag, ChevronDown, ChevronUp, GitBranch, FileText, FileSpreadsheet, File, Download, AlertTriangle, Clock, User, Calendar, ArrowRight, TrendingDown, TrendingUp, Minus, Search, X, CheckSquare, Square } from 'lucide-react'
import { getProject, getModels, uploadModel, uploadModelFile, getFindings, annotateFinding, getComplianceMatrix, reportPdfUrl, reportPptxUrl, retryModel, updateRemediation, getRemediationSummary, compareVersions, saveOpinion } from '../api'
import ScenarioPanel from '../components/ScenarioPanel'
import ImpactPanel from '../components/ImpactPanel'
import ConfiguratorPanel from '../components/ConfiguratorPanel'
import ActivityPanel from '../components/ActivityPanel'

const LIFECYCLE_DISPLAY = {
  initiering:         'Initiation',
  modellutveckling:   'Development',
  implementation:     'Implementation',
  validering:         'Validation',
  modellanvandande:   'In Use',
  modelluppfoljning:  'Monitoring',
  lopande_validering: 'Ongoing Validation',
}
import SeverityBadge from '../components/SeverityBadge'
import StatusBadge from '../components/StatusBadge'

// ── File type icon helper ─────────────────────────────────────────────────────
function FileIcon({ name }) {
  const ext = (name || '').split('.').pop().toLowerCase()
  if (ext === 'pdf') return <FileText size={18} className="text-red-500" />
  if (ext === 'xlsx' || ext === 'xls') return <FileSpreadsheet size={18} className="text-green-600" />
  return <File size={18} className="text-blue-500" />
}

// ── Model upload panel ────────────────────────────────────────────────────────
function ModelUploadPanel({ projectId, onUploaded }) {
  const [mode, setMode]       = useState('file')   // 'file' | 'paste'
  const [text, setText]       = useState('')
  const [file, setFile]       = useState(null)
  const [dragging, setDragging] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState(null)
  const [done, setDone]       = useState(false)

  const ACCEPTED = '.pdf,.doc,.docx,.xlsx,.xls,.txt'

  const handleDrop = e => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) { setFile(dropped); setError(null) }
  }

  const handleFileInput = e => {
    const picked = e.target.files[0]
    if (picked) { setFile(picked); setError(null) }
  }

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (mode === 'file') {
        await uploadModelFile(projectId, file)
      } else {
        await uploadModel(projectId, { raw_text: text, source_type: 'text_paste' })
      }
      setDone(true)
      setFile(null)
      setText('')
      setTimeout(() => { setDone(false); onUploaded() }, 1500)
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed. Check the file format and try again.')
    } finally {
      setSaving(false)
    }
  }

  const canSubmit = mode === 'file' ? !!file : text.trim().length > 0

  return (
    <div className="card p-6">
      <h2 className="font-semibold text-navy mb-1">Upload Model</h2>
      <p className="text-sm text-gray-500 mb-4">
        Upload the model documentation file, or paste the text directly.
        The platform extracts and structures it automatically — regardless of format.
      </p>

      {/* Mode toggle */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit mb-5">
        {[['file', 'Upload File'], ['paste', 'Paste Text']].map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => { setMode(m); setError(null) }}
            className={`px-4 py-1.5 text-sm rounded-md font-medium transition-colors ${
              mode === m ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'file' ? (
          <>
            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                dragging ? 'border-teal bg-teal/5' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
              onClick={() => document.getElementById('file-input').click()}
            >
              <input
                id="file-input"
                type="file"
                accept={ACCEPTED}
                onChange={handleFileInput}
                className="hidden"
              />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileIcon name={file.name} />
                  <div className="text-left">
                    <p className="text-sm font-medium text-navy">{file.name}</p>
                    <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(0)} KB — ready to upload</p>
                  </div>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setFile(null) }}
                    className="ml-4 text-gray-400 hover:text-red-500"
                  >
                    <XCircle size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={24} className="text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500 font-medium">Drop file here or click to browse</p>
                  <p className="text-xs text-gray-400 mt-1">PDF · Word (.docx) · Excel (.xlsx) · Text — up to 20 MB</p>
                </>
              )}
            </div>

            {/* Format notes */}
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">How each format is handled:</p>
              <p><span className="font-medium">PDF / Word</span> — text and embedded tables extracted automatically</p>
              <p><span className="font-medium">Excel</span> — each sheet read as a scoring matrix or factor table</p>
              <p><span className="font-medium">Scanned PDF</span> — if text extraction fails, paste the text instead</p>
            </div>
          </>
        ) : (
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            className="input font-mono text-xs h-52 resize-none"
            placeholder={`Example:\n\nRisk Factors:\n  • Customer Type: Individual=1, Company=2, PEP=5  [weight: 25%]\n  • Product: Current Account=1, FX=3  [weight: 20%]\n  • Geography: Standard=1, High-risk jurisdiction=5  [weight: 30%]\n\nBands:\n  Low: 0–30 | Medium: 31–60 | High: 61–80 | Very High: 81–100\n\nTriggers:\n  • PEP → Override to Very High (independent of score)\n  • Sanctions hit → Immediate escalation`}
          />
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={saving || !canSubmit}
          className="btn-primary flex items-center gap-2"
        >
          {done
            ? <><CheckCircle size={15} /> Uploaded — AI parsing in progress…</>
            : saving
              ? <><RefreshCw size={15} className="animate-spin" /> Uploading…</>
              : <><Upload size={15} /> Upload & Parse</>
          }
        </button>
      </form>
    </div>
  )
}

// ── Remediation status badge ──────────────────────────────────────────────────
function RemediationBadge({ status }) {
  const map = {
    open:          { label: 'Open',          cls: 'bg-red-50 text-red-700 border-red-200' },
    in_progress:   { label: 'In Progress',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    resolved:      { label: 'Resolved',      cls: 'bg-green-50 text-green-700 border-green-200' },
    accepted_risk: { label: 'Risk Accepted', cls: 'bg-gray-50 text-gray-600 border-gray-200' },
  }
  const { label, cls } = map[status] || map.open
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
}

// ── Framework dimension config (Frank Penny / SIMPT kontrollramverk) ──────────
const DIMENSIONS = [
  {
    key:   'modellutformning',
    label: 'Modellutformning',
    en:    'Model Design',
    desc:  'Purpose, assumptions, risk factor selection, fitness for purpose',
    q:     'Har modellen ett tydligt syfte och bygger på lämpliga antaganden?',
  },
  {
    key:   'data',
    label: 'Data',
    en:    'Data',
    desc:  'Data sources, quality, completeness, mapping and transformations',
    q:     'Är data korrekt och komplett, och har datamappning dokumenterats?',
  },
  {
    key:   'implementation_testning',
    label: 'Implementation & Testning',
    en:    'Implementation & Testing',
    desc:  'Scoring logic, band thresholds, trigger implementation, logic correctness',
    q:     'Är modellen implementerad i enlighet med modellutformning och rutiner?',
  },
  {
    key:   'styrning_uppföljning',
    label: 'Styrning & Uppföljning',
    en:    'Governance & Monitoring',
    desc:  'Ownership, roles, documentation, review schedules, change management',
    q:     'Finns det tydliga roller och ansvar under hela modellens livscykel?',
  },
]

function dimRag(dimFindings) {
  if (dimFindings.length === 0) return 'NONE'
  if (dimFindings.some(f => f.severity === 'Critical')) return 'RED'
  if (dimFindings.some(f => f.severity === 'High'))     return 'AMBER'
  return 'GREEN'
}

const RAG_STYLES = {
  RED:   { dot: 'bg-red-500',   banner: 'bg-red-50 border-red-200',    text: 'text-red-700',   label: '✗ Issues found' },
  AMBER: { dot: 'bg-orange-400',banner: 'bg-orange-50 border-orange-200', text: 'text-orange-700', label: '⚠ Review required' },
  GREEN: { dot: 'bg-green-500', banner: 'bg-green-50 border-green-200', text: 'text-green-700', label: '✓ No critical issues' },
  NONE:  { dot: 'bg-gray-300',  banner: 'bg-gray-50 border-gray-200',   text: 'text-gray-500',  label: '— No findings' },
}

// ── Single finding card (shared between grouped and flat views) ───────────────
function FindingCard({ f, expanded, onToggle, onAnnotate, remEdit, onStartEdit, onSaveRemediation, onCancelEdit, onEditChange, saving, selected, onSelectToggle }) {
  const isEditing = !!remEdit[f.id]
  const edit = remEdit[f.id] || {}
  return (
    <div className={`card overflow-hidden ${selected ? 'ring-2 ring-teal' : ''}`}>
      <div
        className="flex items-start gap-3 px-5 py-4 cursor-pointer hover:bg-gray-50"
        onClick={onToggle}
      >
        {onSelectToggle && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSelectToggle() }}
            className="mt-0.5 text-gray-400 hover:text-teal transition-colors flex-shrink-0"
            title={selected ? 'Deselect' : 'Select for bulk action'}
          >
            {selected ? <CheckSquare size={16} className="text-teal" /> : <Square size={16} />}
          </button>
        )}
        <SeverityBadge severity={f.severity} />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-navy">{f.title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{f.category} · {f.source.replace(/_/g, ' ')}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <RemediationBadge status={f.remediation_status || 'open'} />
          {f.annotation_status !== 'pending' && <StatusBadge status={f.annotation_status} />}
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-4">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Finding</p>
            <p className="text-sm text-gray-700">{f.description}</p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Recommendation</p>
            <p className="text-sm text-gray-700">{f.recommendation}</p>
          </div>
          {f.regulatory_reference && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Regulatory Reference</p>
              <p className="text-xs text-teal">{f.regulatory_reference}</p>
            </div>
          )}

          {/* Annotation */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Validation Review</p>
            <div className="flex gap-2">
              {[['accepted','Accept',CheckCircle,'green'],['follow_up','Follow up',Flag,'orange'],['rejected','Reject',XCircle,'gray']].map(([val, label, Icon, color]) => (
                <button key={val} onClick={() => onAnnotate(f.id, val)}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                    f.annotation_status === val
                      ? `bg-${color}-${color==='gray'?500:600} text-white border-${color}-${color==='gray'?500:600}`
                      : `text-${color}-${color==='gray'?500:700} border-${color}-200 hover:bg-${color}-50`
                  }`}>
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </div>

          {/* Remediation tracking */}
          <div className="border-t border-gray-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Remediation</p>
              {!isEditing && (
                <button onClick={() => onStartEdit(f)} className="text-xs text-teal hover:underline">
                  {f.remediation_status === 'open' ? '+ Assign' : 'Edit'}
                </button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-3 bg-white rounded-lg p-4 border border-gray-200">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Status</label>
                    <select
                      value={edit.status || 'open'}
                      onChange={e => onEditChange(f.id, 'status', e.target.value)}
                      className="input text-sm"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="accepted_risk">Accept Risk</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Due date</label>
                    <input type="date" value={edit.due || ''}
                      onChange={e => onEditChange(f.id, 'due', e.target.value)}
                      className="input text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Owner / responsible</label>
                  <input value={edit.owner || ''}
                    onChange={e => onEditChange(f.id, 'owner', e.target.value)}
                    placeholder="Name or team" className="input text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Resolution note</label>
                  <textarea value={edit.note || ''}
                    onChange={e => onEditChange(f.id, 'note', e.target.value)}
                    placeholder="How was this resolved, or why is the risk accepted?"
                    className="input text-sm h-20 resize-none" />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onSaveRemediation(f.id)} disabled={saving[f.id]}
                    className="btn-primary text-xs flex items-center gap-1.5">
                    {saving[f.id] ? <><RefreshCw size={11} className="animate-spin" /> Saving…</> : <><CheckCircle size={11} /> Save</>}
                  </button>
                  <button onClick={() => onCancelEdit(f.id)} className="btn-secondary text-xs">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                {f.remediation_owner && <span className="flex items-center gap-1"><User size={11} /> {f.remediation_owner}</span>}
                {f.remediation_due && <span className="flex items-center gap-1"><Calendar size={11} /> Due {f.remediation_due}</span>}
                {f.remediation_note && <span className="flex items-center gap-1 italic">"{f.remediation_note}"</span>}
                {!f.remediation_owner && !f.remediation_due && !f.remediation_note && <span className="text-gray-400">Not yet assigned</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Findings panel ────────────────────────────────────────────────────────────
function FindingsPanel({ projectId, modelId }) {
  const [findings, setFindings]     = useState([])
  const [remSummary, setRemSummary] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [expanded, setExpanded]     = useState({})
  const [dimExpanded, setDimExpanded] = useState({ modellutformning: true, data: true, implementation_testning: true, styrning_uppföljning: true })
  const [remEdit, setRemEdit]       = useState({})
  const [saving, setSaving]         = useState({})
  const [viewMode, setViewMode]     = useState('framework')  // 'framework' | 'severity'
  // Filters (v0.5)
  const [search, setSearch]         = useState('')
  const [sevFilter, setSevFilter]   = useState('all')   // all | Critical | High | Medium | Low
  const [statusFilter, setStatusFilter] = useState('all') // all | open | in_progress | resolved | accepted_risk
  // Bulk selection (v0.5)
  const [selected, setSelected]     = useState({})  // { findingId: true }
  const [bulkOpen, setBulkOpen]     = useState(false)
  const [bulkEdit, setBulkEdit]     = useState({ status: '', owner: '', due: '' })
  const [bulkSaving, setBulkSaving] = useState(false)

  const recomputeRemSummary = (list) => {
    const today = new Date().toISOString().slice(0, 10)
    const counts = { open: 0, in_progress: 0, resolved: 0, accepted_risk: 0 }
    const overdue = []
    list.forEach(f => {
      const st = f.remediation_status || 'open'
      counts[st] = (counts[st] || 0) + 1
      const due = f.remediation_due
      if (due && !['resolved','accepted_risk'].includes(st) && due < today) {
        overdue.push({
          id: f.id, title: f.title, severity: f.severity,
          remediation_due: due, remediation_owner: f.remediation_owner,
        })
      }
    })
    const total = list.length
    const resolved_count = counts.resolved + counts.accepted_risk
    return {
      total, counts, overdue,
      progress_pct: total > 0 ? Math.round((resolved_count / total) * 100) : 0,
      resolved_count,
    }
  }

  const replaceFinding = (updated) => {
    setFindings(prev => {
      const next = prev.map(f => f.id === updated.id ? { ...f, ...updated } : f)
      setRemSummary(recomputeRemSummary(next))
      return next
    })
  }

  const load = useCallback(() => {
    if (!modelId) return
    setLoading(true)
    Promise.all([getFindings(modelId), getRemediationSummary(projectId, modelId)])
      .then(([fRes, rRes]) => { setFindings(fRes.data); setRemSummary(rRes.data) })
      .finally(() => setLoading(false))
  }, [modelId, projectId])

  useEffect(() => { load() }, [load])

  const annotate = async (findingId, status) => {
    const r = await annotateFinding(findingId, { annotation_status: status, annotation_note: '' })
    replaceFinding(r.data)
  }

  const saveRemediation = async (findingId) => {
    const edit = remEdit[findingId] || {}
    setSaving(s => ({ ...s, [findingId]: true }))
    try {
      const r = await updateRemediation(findingId, {
        remediation_status: edit.status || 'open',
        remediation_owner:  edit.owner  || null,
        remediation_note:   edit.note   || '',
        remediation_due:    edit.due    || null,
      })
      setRemEdit(e => { const n = {...e}; delete n[findingId]; return n })
      replaceFinding(r.data)
    } finally {
      setSaving(s => ({ ...s, [findingId]: false }))
    }
  }

  const startEdit = (f) => setRemEdit(e => ({ ...e, [f.id]: {
    status: f.remediation_status || 'open',
    owner:  f.remediation_owner  || '',
    note:   f.remediation_note   || '',
    due:    f.remediation_due    || '',
  }}))
  const cancelEdit = (id) => setRemEdit(e => { const n={...e}; delete n[id]; return n })
  const handleEditChange = (id, field, val) => setRemEdit(r => ({ ...r, [id]: { ...r[id], [field]: val } }))
  const toggle = id => setExpanded(e => ({ ...e, [id]: !e[id] }))
  const toggleDim = key => setDimExpanded(e => ({ ...e, [key]: !e[key] }))

  const matchesFilters = (f) => {
    if (sevFilter !== 'all' && f.severity !== sevFilter) return false
    if (statusFilter !== 'all' && (f.remediation_status || 'open') !== statusFilter) return false
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const hay = `${f.title} ${f.description} ${f.category} ${f.recommendation} ${f.remediation_owner || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }

  const filteredFindings = findings.filter(matchesFilters)
  const filterActive = sevFilter !== 'all' || statusFilter !== 'all' || search.trim().length > 0
  const clearFilters = () => { setSearch(''); setSevFilter('all'); setStatusFilter('all') }

  const toggleSelect = (id) => setSelected(s => {
    const n = { ...s }
    if (n[id]) delete n[id]; else n[id] = true
    return n
  })
  const selectAllVisible = () => {
    const next = {}
    filteredFindings.forEach(f => { next[f.id] = true })
    setSelected(next)
  }
  const clearSelection = () => { setSelected({}); setBulkOpen(false) }
  const selectedCount = Object.keys(selected).length
  const allVisibleSelected = filteredFindings.length > 0 && filteredFindings.every(f => selected[f.id])

  const applyBulk = async () => {
    if (selectedCount === 0) return
    setBulkSaving(true)
    try {
      const ids = Object.keys(selected).filter(id => findings.find(f => f.id === id))
      const updated = await Promise.all(ids.map(id => {
        const current = findings.find(f => f.id === id)
        return updateRemediation(id, {
          remediation_status: bulkEdit.status || current.remediation_status || 'open',
          remediation_owner:  bulkEdit.owner !== '' ? bulkEdit.owner : (current.remediation_owner || null),
          remediation_note:   current.remediation_note || '',
          remediation_due:    bulkEdit.due !== ''   ? bulkEdit.due   : (current.remediation_due   || null),
        }).then(r => r.data)
      }))
      setFindings(prev => {
        const map = new Map(updated.map(u => [u.id, u]))
        const next = prev.map(f => map.has(f.id) ? { ...f, ...map.get(f.id) } : f)
        setRemSummary(recomputeRemSummary(next))
        return next
      })
      setBulkEdit({ status: '', owner: '', due: '' })
      clearSelection()
    } finally {
      setBulkSaving(false)
    }
  }

  const cardProps = (f) => ({
    f, expanded: !!expanded[f.id], onToggle: () => toggle(f.id),
    onAnnotate: annotate, remEdit, onStartEdit: startEdit,
    onSaveRemediation: saveRemediation, onCancelEdit: cancelEdit,
    onEditChange: handleEditChange, saving,
    selected: !!selected[f.id], onSelectToggle: () => toggleSelect(f.id),
  })

  if (loading) return <div className="text-sm text-gray-400 py-4">Loading findings…</div>
  if (findings.length === 0) return (
    <div className="card p-8 text-center text-gray-400 text-sm">No findings yet. Upload a model to start validation.</div>
  )

  const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 }
  findings.forEach(f => { if (f.severity in counts) counts[f.severity]++ })

  // Group by dimension (filtered)
  const byDim = {}
  DIMENSIONS.forEach(d => { byDim[d.key] = [] })
  const untagged = []
  filteredFindings.forEach(f => {
    if (f.framework_dimension && byDim[f.framework_dimension] !== undefined) {
      byDim[f.framework_dimension].push(f)
    } else {
      untagged.push(f)
    }
  })
  const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3, Observation: 4 }
  DIMENSIONS.forEach(d => { byDim[d.key].sort((a,b) => (sevOrder[a.severity]||9) - (sevOrder[b.severity]||9)) })

  return (
    <div className="space-y-4">
      {/* Remediation progress */}
      {remSummary && remSummary.total > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-600">Remediation Progress</p>
            <span className="text-xs text-gray-500">{remSummary.resolved_count}/{remSummary.total} resolved · {remSummary.progress_pct}%</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-teal rounded-full transition-all" style={{ width: `${remSummary.progress_pct}%` }} />
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500 flex-wrap">
            <span className="text-red-600 font-medium">{remSummary.counts.open} open</span>
            <span className="text-blue-600">{remSummary.counts.in_progress} in progress</span>
            <span className="text-green-600">{remSummary.counts.resolved} resolved</span>
            <span className="text-gray-500">{remSummary.counts.accepted_risk} accepted</span>
            {remSummary.overdue?.length > 0 && (
              <span className="text-orange-600 font-medium flex items-center gap-1"><AlertTriangle size={11} /> {remSummary.overdue.length} overdue</span>
            )}
          </div>
        </div>
      )}

      {/* Header: severity counts + view toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3 flex-wrap items-center">
          {Object.entries(counts).map(([sev, count]) => count > 0 && (
            <div key={sev} className="flex items-center gap-1.5">
              <SeverityBadge severity={sev} />
              <span className="text-sm font-medium text-gray-600">{count}</span>
            </div>
          ))}
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-500">
            {filterActive ? `${filteredFindings.length} of ${findings.length}` : `${findings.length} total`}
          </span>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {[['framework','By Framework'],['severity','By Severity']].map(([m, lbl]) => (
            <button key={m} onClick={() => setViewMode(m)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                viewMode === m ? 'bg-white text-navy shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>{lbl}</button>
          ))}
        </div>
      </div>

      {/* Search + filter toolbar */}
      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-60">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title, description, owner…"
            className="input text-sm pl-9 pr-9 w-full"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={13} />
            </button>
          )}
        </div>
        <select value={sevFilter} onChange={e => setSevFilter(e.target.value)} className="input text-sm w-36">
          <option value="all">All severities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm w-40">
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="accepted_risk">Risk Accepted</option>
        </select>
        {filterActive && (
          <button onClick={clearFilters} className="text-xs text-teal hover:underline flex items-center gap-1">
            <X size={11} /> Clear filters
          </button>
        )}
        <div className="flex-1" />
        {filteredFindings.length > 0 && (
          <button
            onClick={allVisibleSelected ? clearSelection : selectAllVisible}
            className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 font-medium"
          >
            {allVisibleSelected ? <CheckSquare size={12} className="text-teal" /> : <Square size={12} />}
            {allVisibleSelected ? 'Deselect all' : 'Select all visible'}
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="card p-4 bg-teal-pale border-teal/30">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-navy">
              {selectedCount} finding{selectedCount === 1 ? '' : 's'} selected
            </p>
            <div className="flex gap-2">
              <button onClick={() => setBulkOpen(o => !o)} className="btn-secondary text-xs">
                {bulkOpen ? 'Hide bulk edit' : 'Bulk assign…'}
              </button>
              <button onClick={clearSelection} className="text-xs text-gray-500 hover:text-gray-700">Clear</button>
            </div>
          </div>
          {bulkOpen && (
            <div className="bg-white rounded-lg p-4 border border-gray-200 space-y-3">
              <p className="text-xs text-gray-500">Empty fields are left unchanged. Filled fields apply to every selected finding.</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Status</label>
                  <select value={bulkEdit.status} onChange={e => setBulkEdit(b => ({ ...b, status: e.target.value }))} className="input text-sm">
                    <option value="">— unchanged —</option>
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                    <option value="accepted_risk">Accept Risk</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Owner</label>
                  <input value={bulkEdit.owner} onChange={e => setBulkEdit(b => ({ ...b, owner: e.target.value }))}
                    placeholder="— unchanged —" className="input text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Due date</label>
                  <input type="date" value={bulkEdit.due} onChange={e => setBulkEdit(b => ({ ...b, due: e.target.value }))}
                    className="input text-sm" />
                </div>
              </div>
              <button onClick={applyBulk} disabled={bulkSaving} className="btn-primary text-xs flex items-center gap-1.5">
                {bulkSaving ? <><RefreshCw size={11} className="animate-spin" /> Applying…</> : <><CheckCircle size={11} /> Apply to {selectedCount}</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Empty state when filters match nothing */}
      {filteredFindings.length === 0 && (
        <div className="card p-8 text-center text-gray-400 text-sm">
          No findings match the current filters.
          <button onClick={clearFilters} className="ml-2 text-teal hover:underline">Clear filters</button>
        </div>
      )}

      {/* ── Framework view ── */}
      {viewMode === 'framework' && filteredFindings.length > 0 && (
        <div className="space-y-4">
          {/* Framework overview row */}
          <div className="grid grid-cols-4 gap-3">
            {DIMENSIONS.map(d => {
              const rag = dimRag(byDim[d.key])
              const rs  = RAG_STYLES[rag]
              return (
                <button key={d.key} onClick={() => toggleDim(d.key)}
                  className={`text-left p-3 rounded-xl border transition-all hover:opacity-90 ${rs.banner}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${rs.dot}`} />
                    <span className={`text-xs font-bold ${rs.text}`}>{d.label}</span>
                  </div>
                  <p className={`text-xs font-medium ${rs.text}`}>{rs.label}</p>
                  <p className="text-xs text-gray-500 mt-1">{byDim[d.key].length} finding{byDim[d.key].length !== 1 ? 's' : ''}</p>
                </button>
              )
            })}
          </div>

          {/* Dimension sections */}
          {DIMENSIONS.map(d => {
            const rag = dimRag(byDim[d.key])
            const rs  = RAG_STYLES[rag]
            const isOpen = dimExpanded[d.key]
            return (
              <div key={d.key} className="card overflow-hidden">
                {/* Section header */}
                <button
                  onClick={() => toggleDim(d.key)}
                  className={`w-full flex items-center justify-between px-5 py-3.5 border-b text-left ${rs.banner} border-opacity-50`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-full ${rs.dot}`} />
                    <div>
                      <span className={`font-bold text-sm ${rs.text}`}>{d.label}</span>
                      <span className="text-xs text-gray-500 ml-2">({d.en})</span>
                    </div>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${rs.banner} ${rs.text}`}>
                      {rs.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-500">{byDim[d.key].length} finding{byDim[d.key].length !== 1 ? 's' : ''}</span>
                    {isOpen ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                  </div>
                </button>

                {isOpen && (
                  <div>
                    {/* SIMPT validation question */}
                    <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                      <p className="text-xs text-gray-500 italic">"{d.q}"</p>
                    </div>
                    {byDim[d.key].length === 0 ? (
                      <div className="px-5 py-4 text-sm text-gray-400">No findings in this dimension.</div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {byDim[d.key].map(f => (
                          <FindingCard key={f.id} {...cardProps(f)} />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {/* Untagged findings (older findings without a dimension) */}
          {untagged.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Other Findings ({untagged.length})</p>
              </div>
              <div className="divide-y divide-gray-100">
                {untagged.map(f => <FindingCard key={f.id} {...cardProps(f)} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Severity view (flat, original style) ── */}
      {viewMode === 'severity' && filteredFindings.length > 0 && (
        <div className="space-y-3">
          {filteredFindings
            .slice()
            .sort((a,b) => (sevOrder[a.severity]||9) - (sevOrder[b.severity]||9))
            .map(f => <FindingCard key={f.id} {...cardProps(f)} />)
          }
        </div>
      )}
    </div>
  )
}

// ── Version compare panel ─────────────────────────────────────────────────────
function VersionComparePanel({ projectId, versions }) {
  const parsedVersions = versions.filter(v => v.parse_status === 'parsed')

  const [fromId, setFromId] = useState('')
  const [toId,   setToId]   = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]  = useState(null)

  // Auto-select: oldest as "from", newest as "to"
  useEffect(() => {
    if (parsedVersions.length >= 2) {
      setToId(parsedVersions[0].id)                                    // newest
      setFromId(parsedVersions[parsedVersions.length - 1].id)          // oldest
    }
  }, [versions])

  const handleCompare = async () => {
    if (!fromId || !toId || fromId === toId) {
      setError('Select two different parsed versions to compare.')
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await compareVersions(projectId, fromId, toId)
      setResult(r.data)
    } catch (e) {
      setError(e.response?.data?.detail || 'Comparison failed.')
    } finally {
      setLoading(false)
    }
  }

  const recColour = {
    none:     { bg: 'bg-green-50 border-green-200', text: 'text-green-800', icon: '✓' },
    targeted: { bg: 'bg-orange-50 border-orange-200', text: 'text-orange-800', icon: '⚠' },
    project:  { bg: 'bg-red-50 border-red-200', text: 'text-red-800', icon: '✗' },
  }

  if (parsedVersions.length < 2) {
    return (
      <div className="card p-8 text-center text-gray-400 text-sm">
        <p className="font-medium mb-1">Version comparison requires two parsed versions</p>
        <p className="text-xs">Upload an updated model document to compare it against the previous validation.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Version selector */}
      <div className="card p-5">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Select Versions to Compare</p>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <label className="block text-xs text-gray-500 mb-1">From (older version)</label>
            <select value={fromId} onChange={e => setFromId(e.target.value)} className="input text-sm">
              <option value="">Select…</option>
              {parsedVersions.map(v => (
                <option key={v.id} value={v.id}>v{v.version} — {new Date(v.created_at).toLocaleDateString('en-GB')}</option>
              ))}
            </select>
          </div>
          <ArrowRight size={16} className="text-gray-400 mt-5 flex-shrink-0" />
          <div className="flex-1 min-w-40">
            <label className="block text-xs text-gray-500 mb-1">To (newer version)</label>
            <select value={toId} onChange={e => setToId(e.target.value)} className="input text-sm">
              <option value="">Select…</option>
              {parsedVersions.map(v => (
                <option key={v.id} value={v.id}>v{v.version} — {new Date(v.created_at).toLocaleDateString('en-GB')}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleCompare}
            disabled={loading || !fromId || !toId}
            className="btn-primary flex items-center gap-2 mt-5"
          >
            {loading ? <><RefreshCw size={14} className="animate-spin" /> Analysing…</> : 'Compare Versions'}
          </button>
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </div>

      {/* Results */}
      {result && (() => {
        const rc = recColour[result.remediation_recommendation] || recColour.none
        return (
          <div className="space-y-4">
            {/* AI Recommendation card */}
            <div className={`border rounded-xl p-5 ${rc.bg}`}>
              <div className="flex items-start gap-3">
                <span className={`text-2xl font-bold ${rc.text}`}>{rc.icon}</span>
                <div>
                  <p className={`font-bold text-sm ${rc.text}`}>{result.recommendation_label}</p>
                  <p className={`text-sm mt-1 leading-relaxed ${rc.text}`}>{result.recommendation_summary}</p>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Resolved', count: result.resolved_findings.length, colour: 'text-green-700 bg-green-50', Icon: TrendingDown },
                { label: 'New Findings', count: result.new_findings.length, colour: 'text-red-700 bg-red-50', Icon: TrendingUp },
                { label: 'Still Open', count: result.persisting_findings.length, colour: 'text-orange-700 bg-orange-50', Icon: Minus },
              ].map(({ label, count, colour, Icon }) => (
                <div key={label} className={`card p-4 flex items-center gap-3 ${colour}`}>
                  <Icon size={20} />
                  <div>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs font-medium">{label}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Structural changes */}
            {result.structural_changes?.length > 0 && (
              <div className="card p-5">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Model Changes Detected</p>
                <div className="space-y-1.5">
                  {result.structural_changes.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="text-teal mt-0.5">→</span>
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resolved findings */}
            {result.resolved_findings.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 bg-green-50 border-b border-green-100">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">
                    ✓ Resolved Findings ({result.resolved_findings.length})
                  </p>
                </div>
                <div className="divide-y divide-gray-50">
                  {result.resolved_findings.map((f, i) => (
                    <div key={i} className="px-5 py-3 flex items-center gap-3">
                      <SeverityBadge severity={f.severity} />
                      <p className="text-sm text-gray-600 line-through">{f.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* New findings */}
            {result.new_findings.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 bg-red-50 border-b border-red-100">
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                    ✗ New Findings Introduced ({result.new_findings.length})
                  </p>
                </div>
                <div className="divide-y divide-gray-50">
                  {result.new_findings.map((f, i) => (
                    <div key={i} className="px-5 py-3 flex items-center gap-3">
                      <SeverityBadge severity={f.severity} />
                      <p className="text-sm text-navy font-medium">{f.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Persisting findings */}
            {result.persisting_findings.length > 0 && (
              <div className="card overflow-hidden">
                <div className="px-5 py-3 bg-orange-50 border-b border-orange-100">
                  <p className="text-xs font-semibold text-orange-700 uppercase tracking-wide">
                    ~ Still Open ({result.persisting_findings.length})
                  </p>
                </div>
                <div className="divide-y divide-gray-50">
                  {result.persisting_findings.map((f, i) => (
                    <div key={i} className="px-5 py-3 flex items-center gap-3">
                      <SeverityBadge severity={f.severity} />
                      <p className="text-sm text-gray-700">{f.title}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// ── Report download bar ───────────────────────────────────────────────────────
function ReportDownloadBar({ projectId, modelId, parseStatus }) {
  if (parseStatus !== 'parsed') return null
  return (
    <div className="flex items-center gap-3 bg-navy/5 border border-navy/10 rounded-xl px-5 py-3 mb-5">
      <span className="text-sm font-medium text-navy mr-2">Export report:</span>
      <a
        href={reportPdfUrl(projectId, modelId)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 btn-primary text-sm py-1.5 px-4"
      >
        <Download size={14} /> PDF Report
      </a>
      <a
        href={reportPptxUrl(projectId, modelId)}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 btn-secondary text-sm py-1.5 px-4"
      >
        <Download size={14} /> PowerPoint Deck
      </a>
      <span className="text-xs text-gray-400 ml-2">
        Includes regulatory compliance matrix · Swedish law mapping · All findings
      </span>
    </div>
  )
}

// ── Validation Opinion Panel ──────────────────────────────────────────────────
function ValidationOpinionPanel({ projectId, modelId, initialOpinion }) {
  const [opinion, setOpinion] = useState(initialOpinion || '')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  // Sync when a different model version is selected
  useEffect(() => { setOpinion(initialOpinion || ''); setSaved(false) }, [modelId, initialOpinion])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveOpinion(projectId, modelId, opinion)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // silent — user can retry
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-5 mb-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-navy">Validator's Opinion</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Free-text opinion on model fitness — included as the final page of the validation report.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary text-xs flex items-center gap-1.5 py-1.5 px-3 flex-shrink-0"
        >
          {saved
            ? <><CheckCircle size={12} /> Saved</>
            : saving
              ? <><RefreshCw size={12} className="animate-spin" /> Saving…</>
              : 'Save Opinion'
          }
        </button>
      </div>
      <textarea
        value={opinion}
        onChange={e => { setOpinion(e.target.value); setSaved(false) }}
        className="input text-sm h-28 resize-none font-mono"
        placeholder={`Example:\n\nBased on the validation conducted on ${new Date().toLocaleDateString('en-GB')}, the model is assessed as NOT FIT FOR PURPOSE in its current form. Three Critical findings must be resolved before deployment. The model framework is conceptually sound but lacks sufficient documentation of data sources and contains a material scoring gap at the 80-point threshold.\n\nRecommendation: Targeted remediation with re-validation within 60 days.`}
      />
    </div>
  )
}

// ── Compliance matrix panel ───────────────────────────────────────────────────
function CompliancePanel({ projectId, modelId }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)

  useEffect(() => {
    if (!modelId) return
    getComplianceMatrix(projectId, modelId)
      .then(r => setData(r.data))
      .catch(() => setError('Could not load compliance matrix.'))
      .finally(() => setLoading(false))
  }, [projectId, modelId])

  if (loading) return <div className="text-sm text-gray-400 py-6">Loading compliance matrix…</div>
  if (error)   return <div className="text-sm text-red-500 py-4">{error}</div>
  if (!data)   return null

  const { summary, requirements } = data
  const ragColours = {
    GREEN: 'bg-green-100 text-green-800 border-green-200',
    AMBER: 'bg-orange-100 text-orange-800 border-orange-200',
    RED:   'bg-red-100 text-red-800 border-red-200',
  }
  const statusColours = {
    MET:     'text-green-700 bg-green-50',
    PARTIAL: 'text-orange-700 bg-orange-50',
    NOT_MET: 'text-red-700 bg-red-50',
    UNCLEAR: 'text-gray-500 bg-gray-50',
  }
  const statusLabels = {
    MET: '✓ Met', PARTIAL: '~ Partial', NOT_MET: '✗ Not Met', UNCLEAR: '? Unclear'
  }

  return (
    <div className="space-y-4">
      {/* Summary banner */}
      <div className={`border rounded-xl px-5 py-4 flex items-center gap-4 ${ragColours[summary.rag]}`}>
        <div className="font-bold text-lg">{summary.rag}</div>
        <div>
          <p className="font-semibold text-sm">{summary.rag_label}</p>
          <p className="text-xs mt-0.5">
            {summary.counts.MET} met · {summary.counts.PARTIAL} partial · {summary.counts.NOT_MET} not met ·{' '}
            {summary.counts.UNCLEAR} unclear — {summary.met_pct}% compliance rate
          </p>
        </div>
      </div>

      {/* Requirements table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Swedish Regulatory Requirements — PTL · FFFS 2017:11 · SIMPT 2024
          </p>
          <span className="text-xs text-gray-400">{requirements.length} requirements</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-20">ID</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-40">Law</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Requirement</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 w-28">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {requirements.map(r => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-xs font-mono text-teal font-bold">{r.id}</td>
                <td className="px-4 py-3 text-xs text-gray-500">{r.law}</td>
                <td className="px-4 py-3">
                  <p className="font-medium text-navy text-xs">{r.short}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{r.what_model_must_do}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColours[r.status]}`}>
                    {statusLabels[r.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Model version list ────────────────────────────────────────────────────────
function ModelVersionList({ versions, selectedId, onSelect, onRetry }) {
  const [retrying, setRetrying] = useState({})

  if (versions.length === 0) return null

  const handleRetry = async (e, projectId, modelId) => {
    e.stopPropagation()
    setRetrying(r => ({ ...r, [modelId]: true }))
    try {
      await retryModel(projectId, modelId)
      onRetry()
    } catch (err) {
      alert(err.response?.data?.detail || 'Retry failed.')
    } finally {
      setRetrying(r => ({ ...r, [modelId]: false }))
    }
  }

  return (
    <div className="card overflow-hidden mb-6">
      <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Model Versions</p>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-gray-100">
          {versions.map(v => (
            <tr
              key={v.id}
              onClick={() => onSelect(v.id)}
              className={`cursor-pointer transition-colors ${selectedId === v.id ? 'bg-teal-pale' : 'hover:bg-gray-50'}`}
            >
              <td className="px-5 py-3 font-medium text-navy">v{v.version}</td>
              <td className="px-5 py-3"><StatusBadge status={v.parse_status} /></td>
              <td className="px-5 py-3 text-gray-400 text-xs">
                {new Date(v.created_at).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
              </td>
              <td className="px-5 py-3 text-gray-500 text-xs">{v.finding_count} findings</td>
              <td className="px-5 py-3 text-right">
                {(v.parse_status === 'failed' || v.parse_status === 'parsing') && (
                  <button
                    onClick={e => handleRetry(e, v.project_id, v.id)}
                    disabled={retrying[v.id]}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-orange-200 text-orange-600 hover:bg-orange-50 font-medium transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={retrying[v.id] ? 'animate-spin' : ''} />
                    {retrying[v.id] ? 'Retrying…' : 'Retry'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectDetail() {
  const { id }          = useParams()
  const navigate        = useNavigate()
  const [project, setProject]     = useState(null)
  const [versions, setVersions]   = useState([])
  const [selectedModel, setSelectedModel] = useState(null)
  const [tab, setTab]   = useState('upload')   // 'upload' | 'findings' | 'compliance' | 'scenarios'
  const [loading, setLoading] = useState(true)

  const loadProject = useCallback(async () => {
    try {
      const [proj, mods] = await Promise.all([getProject(id), getModels(id)])
      setProject(proj.data)
      setVersions(mods.data)
      if (mods.data.length > 0 && !selectedModel) {
        setSelectedModel(mods.data[0].id)
        setTab('findings')
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadProject() }, [loadProject])

  // Poll parse status if any version is still parsing
  useEffect(() => {
    const still_parsing = versions.some(v => v.parse_status === 'parsing')
    if (!still_parsing) return
    const t = setTimeout(loadProject, 3000)
    return () => clearTimeout(t)
  }, [versions, loadProject])

  if (loading) return <div className="p-8 text-gray-400">Loading…</div>
  if (!project) return <div className="p-8 text-red-500">Project not found.</div>

  return (
    <div className="p-8">
      {/* Header */}
      <button onClick={() => navigate('/')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-5">
        <ArrowLeft size={14} /> Back to projects
      </button>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-navy">{project.name}</h1>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {project.institution && <span className="text-sm text-gray-500">{project.institution}</span>}
            {project.owner && <span className="text-sm text-gray-400">· {project.owner}</span>}
            <span className="text-xs bg-navy/10 text-navy px-2 py-0.5 rounded font-medium">{project.domain}</span>
            <StatusBadge status={project.status} />
            {project.lifecycle_stage && (
              <span className="flex items-center gap-1 text-xs bg-teal/10 text-teal px-2 py-0.5 rounded font-medium">
                <GitBranch size={10} />
                {LIFECYCLE_DISPLAY[project.lifecycle_stage] || project.lifecycle_stage}
              </span>
            )}
          </div>
          {project.notes && <p className="text-sm text-gray-400 mt-2 max-w-2xl">{project.notes}</p>}
        </div>
        <button onClick={loadProject} className="btn-secondary flex items-center gap-1.5 text-sm">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Version list */}
      <ModelVersionList
        versions={versions}
        selectedId={selectedModel}
        onSelect={vid => { setSelectedModel(vid); setTab('findings') }}
        onRetry={loadProject}
      />

      {/* Report download bar + Validation Opinion — shown when a parsed model is selected */}
      {selectedModel && versions.find(v => v.id === selectedModel)?.parse_status === 'parsed' && (
        <>
          <ReportDownloadBar
            projectId={id}
            modelId={selectedModel}
            parseStatus="parsed"
          />
          <ValidationOpinionPanel
            projectId={id}
            modelId={selectedModel}
            initialOpinion={versions.find(v => v.id === selectedModel)?.validation_opinion || ''}
          />
        </>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-5">
        {[
          { key: 'upload',     label: 'Upload Model' },
          { key: 'findings',   label: `Findings${selectedModel && versions.find(v=>v.id===selectedModel)?.finding_count > 0 ? ` (${versions.find(v=>v.id===selectedModel)?.finding_count})` : ''}` },
          { key: 'compliance', label: 'Swedish Law ✓' },
          { key: 'scenarios',  label: 'Scenarios' },
          { key: 'compare',    label: 'Compare Versions' },
          { key: 'impact',     label: 'Portfolio Impact' },
          { key: 'configurator', label: 'Configurator' },
          { key: 'activity',     label: 'Activity' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === key
                ? 'border-teal text-teal'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'upload' && (
        <ModelUploadPanel projectId={id} onUploaded={loadProject} />
      )}

      {tab === 'findings' && (
        selectedModel
          ? <FindingsPanel projectId={id} modelId={selectedModel} />
          : <div className="card p-8 text-center text-gray-400 text-sm">Upload a model first to see findings.</div>
      )}

      {tab === 'compliance' && (
        selectedModel
          ? <CompliancePanel projectId={id} modelId={selectedModel} />
          : <div className="card p-8 text-center text-gray-400 text-sm">Upload a model first to see the compliance matrix.</div>
      )}

      {tab === 'scenarios' && (
        selectedModel
          ? <ScenarioPanel
              projectId={id}
              modelId={selectedModel}
              structured={versions.find(v => v.id === selectedModel)?.structured}
              parseStatus={versions.find(v => v.id === selectedModel)?.parse_status}
            />
          : <div className="card p-8 text-center text-gray-400 text-sm">Upload a model first to run scenarios.</div>
      )}

      {tab === 'compare' && (
        <VersionComparePanel projectId={id} versions={versions} />
      )}

      {tab === 'impact' && (
        <ImpactPanel projectId={id} versions={versions} />
      )}

      {tab === 'configurator' && (
        selectedModel
          ? <ConfiguratorPanel
              projectId={id}
              modelId={selectedModel}
              structured={versions.find(v => v.id === selectedModel)?.structured}
              parseStatus={versions.find(v => v.id === selectedModel)?.parse_status}
              modelVersion={versions.find(v => v.id === selectedModel)?.version}
            />
          : <div className="card p-8 text-center text-gray-400 text-sm">Upload a model first to configure its parameters.</div>
      )}

      {tab === 'activity' && (
        <ActivityPanel projectId={id} />
      )}
    </div>
  )
}
