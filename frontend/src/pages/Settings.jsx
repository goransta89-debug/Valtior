import { useEffect, useState, useCallback } from 'react'
import { Settings as SettingsIcon, Key, Building2, Globe, BookOpen, CheckCircle, AlertCircle, RefreshCw, Trash2, ExternalLink } from 'lucide-react'
import { getSettings, updateSettings, getModelRegister } from '../api'
import StatusBadge from '../components/StatusBadge'

const REGULATORY_OPTIONS = [
  { id: 'PTL',          label: 'PTL (2017:630)',      desc: 'Penningtvättslagen — Swedish AML Act' },
  { id: 'FFFS_2017_11', label: 'FFFS 2017:11',        desc: 'Finansinspektionen model validation rules' },
  { id: 'FATF',         label: 'FATF Recommendations', desc: 'FATF 40 Recommendations (risk-based approach)' },
  { id: 'SIMPT_2024',   label: 'SIMPT 2024',           desc: 'Vägledning Modellriskhantering (Nov 2024)' },
  { id: 'EU_AMLD6',     label: 'EU AMLD6',             desc: '6th Anti-Money Laundering Directive' },
]

const LIFECYCLE_LABELS = {
  initiering:         'Initiation',
  modellutveckling:   'Development',
  implementation:     'Implementation',
  validering:         'Validation',
  modellanvandande:   'In Use',
  modelluppfoljning:  'Monitoring',
  lopande_validering: 'Ongoing Validation',
}

// ── API Key section ───────────────────────────────────────────────────────────
function ApiKeySection({ settings, onSaved }) {
  const [key, setKey]       = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [error, setError]   = useState(null)
  const [reveal, setReveal] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await updateSettings({ anthropic_api_key: key })
      setSaved(true)
      setKey('')
      setReveal(false)
      onSaved()
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError('Failed to save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!window.confirm('Remove the stored API key? The system will fall back to the environment variable.')) return
    setSaving(true)
    try {
      await updateSettings({ anthropic_api_key: '' })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-teal/10 rounded-lg"><Key size={18} className="text-teal" /></div>
        <div>
          <h2 className="font-semibold text-navy">Anthropic API Key</h2>
          <p className="text-xs text-gray-500">Used for AI parsing, validation, and scenario generation</p>
        </div>
      </div>

      {/* Status pill */}
      <div className={`flex items-center gap-2 text-sm font-medium mb-5 px-3 py-2 rounded-lg w-fit ${
        settings?.api_key_configured
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-red-50 text-red-700 border border-red-200'
      }`}>
        {settings?.api_key_configured
          ? <><CheckCircle size={14} /> API key configured</>
          : <><AlertCircle size={14} /> No API key — AI features disabled</>
        }
      </div>

      <div className="space-y-3">
        <div className="relative">
          <input
            type={reveal ? 'text' : 'password'}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="input pr-20 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setReveal(r => !r)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
          >
            {reveal ? 'Hide' : 'Show'}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || !key.trim()}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            {saved
              ? <><CheckCircle size={14} /> Saved</>
              : saving
                ? <><RefreshCw size={14} className="animate-spin" /> Saving…</>
                : 'Save Key'
            }
          </button>

          {settings?.api_key_configured && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700"
            >
              <Trash2 size={13} /> Clear stored key
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400">
          The key is stored in the database and never returned to the browser.
          Get your key at{' '}
          <a href="https://console.anthropic.com" target="_blank" rel="noreferrer"
            className="text-teal hover:underline inline-flex items-center gap-0.5">
            console.anthropic.com <ExternalLink size={10} />
          </a>
        </p>
      </div>
    </div>
  )
}

// ── Organisation branding ─────────────────────────────────────────────────────
function OrgSection({ settings, onSaved }) {
  const [orgName, setOrgName]   = useState('')
  const [logoUrl, setLogoUrl]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  useEffect(() => {
    if (settings) {
      setOrgName(settings.org_name || '')
      setLogoUrl(settings.org_logo_url || '')
    }
  }, [settings])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings({ org_name: orgName, org_logo_url: logoUrl })
      setSaved(true)
      onSaved()
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-teal/10 rounded-lg"><Building2 size={18} className="text-teal" /></div>
        <div>
          <h2 className="font-semibold text-navy">Organisation</h2>
          <p className="text-xs text-gray-500">Shown on reports and exports — your white-label identity</p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Organisation name</label>
          <input
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            placeholder="e.g. Nordic AML Consulting AB"
            className="input"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Logo URL (optional)</label>
          <input
            value={logoUrl}
            onChange={e => setLogoUrl(e.target.value)}
            placeholder="https://your-site.com/logo.png"
            className="input"
          />
          <p className="text-xs text-gray-400 mt-1">Logo appears on exported PDF reports. Leave blank to use the Valtior logo.</p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          {saved
            ? <><CheckCircle size={14} /> Saved</>
            : saving
              ? <><RefreshCw size={14} className="animate-spin" /> Saving…</>
              : 'Save Organisation'
          }
        </button>
      </div>
    </div>
  )
}

// ── Regulatory profile ────────────────────────────────────────────────────────
function RegulatorySection({ settings, onSaved }) {
  const [selected, setSelected] = useState([])
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  useEffect(() => {
    if (settings?.regulatory_profile) {
      setSelected(settings.regulatory_profile)
    }
  }, [settings])

  const toggle = id => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateSettings({ regulatory_profile: selected })
      setSaved(true)
      onSaved()
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-teal/10 rounded-lg"><Globe size={18} className="text-teal" /></div>
        <div>
          <h2 className="font-semibold text-navy">Regulatory Profile</h2>
          <p className="text-xs text-gray-500">Which regulatory frameworks apply to your validation work</p>
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {REGULATORY_OPTIONS.map(opt => (
          <label
            key={opt.id}
            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
              selected.includes(opt.id)
                ? 'bg-teal/5 border-teal/30'
                : 'border-gray-100 hover:bg-gray-50'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(opt.id)}
              onChange={() => toggle(opt.id)}
              className="mt-0.5 accent-teal"
            />
            <div>
              <p className="text-sm font-medium text-navy">{opt.label}</p>
              <p className="text-xs text-gray-500">{opt.desc}</p>
            </div>
          </label>
        ))}
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="btn-primary flex items-center gap-2 text-sm"
      >
        {saved
          ? <><CheckCircle size={14} /> Saved</>
          : saving
            ? <><RefreshCw size={14} className="animate-spin" /> Saving…</>
            : 'Save Profile'
        }
      </button>
    </div>
  )
}

// ── Model Register ────────────────────────────────────────────────────────────
function ModelRegister() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getModelRegister()
      .then(r => setEntries(r.data))
      .finally(() => setLoading(false))
  }, [])

  const parseStatusColor = status => ({
    parsed:  'text-green-700 bg-green-50',
    parsing: 'text-orange-600 bg-orange-50',
    failed:  'text-red-600 bg-red-50',
    pending: 'text-gray-500 bg-gray-50',
  }[status] || 'text-gray-500 bg-gray-50')

  return (
    <div className="card overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center gap-3">
        <BookOpen size={16} className="text-navy" />
        <div>
          <h2 className="font-semibold text-navy text-sm">Model Register</h2>
          <p className="text-xs text-gray-500">SIMPT Vägledning §3 — all model versions across all projects</p>
        </div>
        <span className="ml-auto text-xs text-gray-400">{entries.length} models</span>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-400 text-sm">Loading register…</div>
      ) : entries.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">No models yet. Upload a model to a project to see it here.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Project</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Institution</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Lifecycle</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Version</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Findings</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.model_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-navy">{e.project_name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{e.institution || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {LIFECYCLE_LABELS[e.lifecycle_stage] || e.lifecycle_stage}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-600">v{e.model_version}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${parseStatusColor(e.parse_status)}`}>
                      {e.parse_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{e.finding_count}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">
                    {new Date(e.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main Settings page ────────────────────────────────────────────────────────
export default function Settings() {
  const [settings, setSettings] = useState(null)

  const load = useCallback(() => {
    getSettings().then(r => setSettings(r.data))
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <SettingsIcon size={20} className="text-navy" />
          <h1 className="text-2xl font-bold text-navy">Settings</h1>
        </div>
        <p className="text-sm text-gray-500">Platform configuration, API keys, and governance register</p>
      </div>

      <div className="space-y-5">
        <ApiKeySection settings={settings} onSaved={load} />
        <OrgSection settings={settings} onSaved={load} />
        <RegulatorySection settings={settings} onSaved={load} />
      </div>

      <div className="mt-8">
        <ModelRegister />
      </div>
    </div>
  )
}
