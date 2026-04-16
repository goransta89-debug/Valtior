import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, FolderOpen, AlertTriangle, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp, Calendar, User } from 'lucide-react'
import { getProjects, getOverdueAcrossProjects } from '../api'

const LIFECYCLE_LABELS = {
  initiering:         { label: 'Initiation',        colour: 'bg-gray-100 text-gray-600' },
  modellutveckling:   { label: 'Development',        colour: 'bg-blue-100 text-blue-700' },
  implementation:     { label: 'Implementation',     colour: 'bg-purple-100 text-purple-700' },
  validering:         { label: 'Validation',          colour: 'bg-teal-pale text-teal' },
  modellanvandande:   { label: 'In Use',              colour: 'bg-green-100 text-green-700' },
  modelluppfoljning:  { label: 'Monitoring',          colour: 'bg-yellow-100 text-yellow-700' },
  lopande_validering: { label: 'Ongoing Validation',  colour: 'bg-orange-100 text-orange-700' },
}

// ── RAG status config ─────────────────────────────────────────────────────────
const RAG = {
  RED:   { dot: 'bg-red-500',    badge: 'bg-red-50 text-red-700 border-red-200',    label: 'Critical issues' },
  AMBER: { dot: 'bg-orange-400', badge: 'bg-orange-50 text-orange-700 border-orange-200', label: 'High issues' },
  GREEN: { dot: 'bg-green-500',  badge: 'bg-green-50 text-green-700 border-green-200',    label: 'Clean' },
  NONE:  { dot: 'bg-gray-300',   badge: 'bg-gray-50 text-gray-500 border-gray-200',       label: 'Not validated' },
}

function RagDot({ status }) {
  const cfg = RAG[status] || RAG.NONE
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${cfg.dot}`}
      title={cfg.label}
    />
  )
}

function LifecycleBadge({ stage }) {
  const info = LIFECYCLE_LABELS[stage] || { label: stage || '—', colour: 'bg-gray-100 text-gray-500' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${info.colour}`}>
      {info.label}
    </span>
  )
}

function StatCard({ label, value, icon: Icon, colour, sub }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`p-3 rounded-lg ${colour}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-2xl font-bold text-navy">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function IssuePill({ count, severity }) {
  if (!count) return null
  const colours = {
    Critical: 'bg-red-100 text-red-700',
    High:     'bg-orange-100 text-orange-700',
    Medium:   'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${colours[severity]}`}>
      {count} {severity}
    </span>
  )
}

function OverdueWidget({ items, expanded, onToggle, onJump }) {
  if (!items || items.length === 0) return null
  const sevColour = {
    Critical: 'bg-red-100 text-red-700 border-red-200',
    High:     'bg-orange-100 text-orange-700 border-orange-200',
    Medium:   'bg-yellow-100 text-yellow-700 border-yellow-200',
    Low:      'bg-gray-100 text-gray-600 border-gray-200',
  }
  const top = items.slice(0, 5)
  const remaining = items.length - top.length

  return (
    <div className="card border-orange-200 bg-orange-50/40 mb-6 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-orange-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-orange-500">
            <AlertTriangle size={16} className="text-white" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-sm text-orange-900">
              {items.length} overdue remediation item{items.length === 1 ? '' : 's'}
            </p>
            <p className="text-xs text-orange-700">
              Past due across {new Set(items.map(i => i.project_id)).size} project{new Set(items.map(i => i.project_id)).size === 1 ? '' : 's'}
              {' · '}
              {items.filter(i => i.severity === 'Critical').length} Critical
              {' · '}
              {items.filter(i => i.severity === 'High').length} High
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={16} className="text-orange-700" /> : <ChevronDown size={16} className="text-orange-700" />}
      </button>

      {expanded && (
        <div className="border-t border-orange-200 divide-y divide-orange-100 bg-white">
          {(expanded === 'all' ? items : top).map(it => (
            <button
              key={it.finding_id}
              onClick={() => onJump(it.project_id)}
              className="w-full text-left px-5 py-3 hover:bg-orange-50 transition-colors flex items-center gap-4"
            >
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${sevColour[it.severity] || sevColour.Low}`}>
                {it.severity}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-navy font-medium truncate">{it.title}</p>
                <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-3 flex-wrap">
                  <span className="text-teal font-medium">{it.project_name}</span>
                  <span>v{it.model_version}</span>
                  {it.remediation_owner && (
                    <span className="flex items-center gap-1"><User size={10} /> {it.remediation_owner}</span>
                  )}
                  <span className="flex items-center gap-1 text-orange-700">
                    <Calendar size={10} /> Due {it.remediation_due} · {it.days_overdue}d late
                  </span>
                </p>
              </div>
            </button>
          ))}
          {expanded !== 'all' && remaining > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggle('all') }}
              className="w-full text-center px-5 py-2.5 text-xs font-medium text-orange-700 hover:bg-orange-50"
            >
              Show {remaining} more…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [overdue, setOverdue]   = useState([])
  const [overdueExpanded, setOverdueExpanded] = useState(false)

  useEffect(() => {
    getProjects()
      .then(r => setProjects(r.data))
      .catch(() => setError('Could not connect to the backend. Is Docker running?'))
      .finally(() => setLoading(false))
    getOverdueAcrossProjects()
      .then(r => setOverdue(r.data.items || []))
      .catch(() => { /* widget hidden if call fails */ })
  }, [])

  const toggleOverdue = (mode) => {
    if (mode === 'all') { setOverdueExpanded('all'); return }
    setOverdueExpanded(e => e ? false : true)
  }

  const openCritical = projects.reduce((s, p) => s + (p.open_critical || 0), 0)
  const openHigh     = projects.reduce((s, p) => s + (p.open_high     || 0), 0)
  const validated    = projects.filter(p => p.rag_status && p.rag_status !== 'NONE').length

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-navy">Projects</h1>
          <p className="text-gray-500 text-sm mt-1">AML/KYC model validation engagements</p>
        </div>
        <button onClick={() => navigate('/projects/new')} className="btn-primary flex items-center gap-2">
          <Plus size={16} />
          New Project
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Total Projects"
          value={projects.length}
          icon={FolderOpen}
          colour="bg-navy"
        />
        <StatCard
          label="With Validated Model"
          value={validated}
          icon={CheckCircle}
          colour="bg-teal"
          sub={`${projects.length - validated} not yet validated`}
        />
        <StatCard
          label="Open Critical"
          value={openCritical}
          icon={XCircle}
          colour={openCritical > 0 ? 'bg-red-500' : 'bg-gray-400'}
          sub="across all projects"
        />
        <StatCard
          label="Open High"
          value={openHigh}
          icon={AlertTriangle}
          colour={openHigh > 0 ? 'bg-orange-400' : 'bg-gray-400'}
          sub="across all projects"
        />
      </div>

      {/* Cross-project overdue widget */}
      <OverdueWidget
        items={overdue}
        expanded={overdueExpanded}
        onToggle={toggleOverdue}
        onJump={(pid) => navigate(`/projects/${pid}`)}
      />

      {/* Error */}
      {error && (
        <div className="card p-6 flex items-center gap-3 border-red-200 bg-red-50 mb-6">
          <AlertTriangle size={20} className="text-red-600 flex-shrink-0" />
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-16 text-gray-400">Loading projects…</div>
      )}

      {/* Empty state */}
      {!loading && !error && projects.length === 0 && (
        <div className="card p-16 text-center">
          <FolderOpen size={40} className="text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No projects yet</p>
          <p className="text-gray-400 text-sm mb-4">Create your first validation engagement to get started.</p>
          <button onClick={() => navigate('/projects/new')} className="btn-primary inline-flex items-center gap-2">
            <Plus size={15} />
            New Project
          </button>
        </div>
      )}

      {/* Project table */}
      {!loading && projects.length > 0 && (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Project</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Institution</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Lifecycle</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Validation Status</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Open Issues</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Last Validated</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Versions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map(p => {
                const rag = RAG[p.rag_status] || RAG.NONE
                return (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/projects/${p.id}`)}
                    className="hover:bg-brand-bg cursor-pointer transition-colors"
                  >
                    {/* Project name + RAG dot */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <RagDot status={p.rag_status} />
                        <div>
                          <p className="font-medium text-navy">{p.name}</p>
                          {p.owner && <p className="text-xs text-gray-400 mt-0.5">{p.owner}</p>}
                        </div>
                      </div>
                    </td>

                    {/* Institution */}
                    <td className="px-5 py-3.5 text-gray-600">{p.institution || '—'}</td>

                    {/* Lifecycle */}
                    <td className="px-5 py-3.5">
                      <LifecycleBadge stage={p.lifecycle_stage} />
                    </td>

                    {/* RAG status badge */}
                    <td className="px-5 py-3.5">
                      {p.rag_status === 'NONE' ? (
                        <span className="text-xs text-gray-400">Not validated</span>
                      ) : (
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${rag.badge}`}>
                          {p.rag_status}
                        </span>
                      )}
                    </td>

                    {/* Open issues */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {p.open_critical > 0 || p.open_high > 0 || p.open_medium > 0 ? (
                          <>
                            <IssuePill count={p.open_critical} severity="Critical" />
                            <IssuePill count={p.open_high}     severity="High" />
                            <IssuePill count={p.open_medium}   severity="Medium" />
                          </>
                        ) : (
                          p.rag_status !== 'NONE'
                            ? <span className="text-xs text-green-600 font-medium">✓ None</span>
                            : <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>

                    {/* Last validated */}
                    <td className="px-5 py-3.5 text-gray-500 text-xs">
                      {p.last_validated_at
                        ? new Date(p.last_validated_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })
                        : <span className="text-gray-300">—</span>
                      }
                    </td>

                    {/* Version count */}
                    <td className="px-5 py-3.5 text-gray-500 text-xs">{p.model_count}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
