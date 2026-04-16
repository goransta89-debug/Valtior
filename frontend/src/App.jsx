import { Routes, Route, NavLink } from 'react-router-dom'
import { Shield, FolderOpen, Settings } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import ProjectDetail from './pages/ProjectDetail'
import NewProject from './pages/NewProject'
import SettingsPage from './pages/Settings'

function Sidebar() {
  const navItem = (to, icon, label, end = false) => (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
          isActive ? 'bg-teal text-white' : 'text-blue-200 hover:bg-navy-light hover:text-white'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )

  return (
    <aside className="w-56 bg-navy min-h-screen flex flex-col flex-shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-navy-light">
        <div className="flex items-center gap-2">
          <Shield className="text-teal" size={22} />
          <span className="text-white font-bold text-lg tracking-tight">Valtior</span>
        </div>
        <p className="text-blue-300 text-xs mt-0.5">Model Validation</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItem('/', <FolderOpen size={16} />, 'Projects', true)}
      </nav>

      {/* Bottom nav */}
      <div className="px-3 py-3 border-t border-navy-light space-y-1">
        {navItem('/settings', <Settings size={16} />, 'Settings')}
        <div className="px-3 pt-2">
          <p className="text-blue-400 text-xs">v0.5</p>
        </div>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <Routes>
          <Route path="/"             element={<Dashboard />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/settings"     element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  )
}
