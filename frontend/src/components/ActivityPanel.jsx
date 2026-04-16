/**
 * ActivityPanel — read-only audit log for a project.
 * Required for FFFS 2017:11 traceability — shows who did what and when.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Activity, RefreshCw, ChevronDown, ChevronRight, FileText,
  Edit3, CheckCircle, Upload, Settings2, BarChart3, FolderPlus, FilePlus, ClipboardCheck,
} from 'lucide-react'
import { getProjectAuditLog } from '../api'

// ── Action display config ─────────────────────────────────────────────────────
const ACTIONS = {
  finding_annotated:    { label: 'Finding annotated',     icon: ClipboardCheck, color: 'text-blue-600 bg-blue-50' },
  remediation_updated:  { label: 'Remediation updated',   icon: Edit3,          color: 'text-orange-600 bg-orange-50' },
  opinion_saved:        { label: "Validator's opinion",   icon: FileText,       color: 'text-teal bg-teal-pale' },
  model_uploaded:       { label: 'Model uploaded',        icon: Upload,         color: 'text-navy bg-gray-100' },
  project_created:      { label: 'Project created',       icon: FolderPlus,     color: 'text-green-700 bg-green-50' },
  project_updated:      { label: 'Project updated',       icon: Edit3,          color: 'text-gray-700 bg-gray-100' },
  impact_run:           { label: 'Portfolio impact run',  icon: BarChart3,      color: 'text-purple-700 bg-purple-50' },
  whatif_simulated:     { label: 'What-if simulation',    icon: Settings2,      color: 'text-purple-700 bg-purple-50' },
}

const FILTER_OPTIONS = [
  { val: 'all',                 label: 'All actions' },
  { val: 'finding_annotated',   label: 'Annotations' },
  { val: 'remediation_updated', label: 'Remediation' },
  { val: 'opinion_saved',       label: "Validator's opinion" },
  { val: 'model_uploaded',      label: 'Model uploads' },
  { val: 'project_created,project_updated', label: 'Project edits' },
  { val: 'impact_run,whatif_simulated',     label: 'Impact / what-if' },
]

function timeAgo(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec/60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec/3600)}h ago`
  if (diffSec < 86400*7) return `${Math.floor(diffSec/86400)}d ago`
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function EntryRow({ entry }) {
  const cfg = ACTIONS[entry.action] || { label: entry.action, icon: Activity, color: 'text-gray-600 bg-gray-100' }
  const [open, setOpen] = useState(false)
  const Icon = cfg.icon
  const hasDetails = entry.details && Object.keys(entry.details).length > 0

  return (
    <div className="border-b border-gray-100 last:border-0">
      <div
        className={`px-5 py-3 flex items-start gap-3 ${hasDetails ? 'cursor-pointer hover:bg-gray-50' : ''}`}
        onClick={() => hasDetails && setOpen(o => !o)}
      >
        <div className={`p-1.5 rounded-lg flex-shrink-0 ${cfg.color}`}>
          <Icon size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-navy">{cfg.label}</span>
            <span className="text-xs text-gray-400">·</span>
            <span className="text-xs text-gray-500">{entry.actor}</span>
            <span className="text-xs text-gray-300">·</span>
            <span className="text-xs text-gray-400" title={entry.created_at}>{timeAgo(entry.created_at)}</span>
          </div>
          {entry.summary && (
            <p className="text-xs text-gray-600 mt-0.5 break-words">{entry.summary}</p>
          )}
        </div>
        {hasDetails && (
          open
            ? <ChevronDown  size={14} className="text-gray-400 flex-shrink-0 mt-1" />
            : <ChevronRight size={14} className="text-gray-400 flex-shrink-0 mt-1" />
        )}
      </div>
      {open && hasDetails && (
        <pre className="bg-gray-50 border-t border-gray-100 px-5 py-3 text-[11px] text-gray-600 overflow-x-auto">
          {JSON.stringify(entry.details, null, 2)}
        </pre>
      )}
    </div>
  )
}

export default function ActivityPanel({ projectId }) {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all')

  const load = useCallback(() => {
    setLoading(true)
    const opts = filter === 'all' ? {} : { action: filter }
    getProjectAuditLog(projectId, opts)
      .then(r => setEntries(r.data.items || []))
      .finally(() => setLoading(false))
  }, [projectId, filter])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      <div className="card p-4 flex items-center gap-3">
        <Activity size={16} className="text-teal" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-navy">Activity Log</p>
          <p className="text-xs text-gray-500">Immutable audit trail — required for FFFS 2017:11 traceability.</p>
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="input text-sm w-52">
          {FILTER_OPTIONS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <button onClick={load} className="btn-secondary text-xs flex items-center gap-1.5">
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading && entries.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">Loading activity…</div>
      ) : entries.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          No activity recorded {filter !== 'all' ? 'for this filter.' : 'yet.'}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{entries.length} entries</p>
            <p className="text-xs text-gray-400">Newest first</p>
          </div>
          {entries.map(e => <EntryRow key={e.id} entry={e} />)}
        </div>
      )}
    </div>
  )
}
