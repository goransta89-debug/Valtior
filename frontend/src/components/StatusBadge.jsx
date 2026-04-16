const colours = {
  active:    'bg-teal-pale text-teal border border-teal/20',
  validated: 'bg-green-50 text-green-700 border border-green-200',
  archived:  'bg-gray-100 text-gray-500 border border-gray-200',
  parsing:   'bg-yellow-50 text-yellow-700 border border-yellow-200',
  parsed:    'bg-teal-pale text-teal border border-teal/20',
  failed:    'bg-red-50 text-red-700 border border-red-200',
  pending:   'bg-gray-100 text-gray-500 border border-gray-200',
}

export default function StatusBadge({ status, label }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colours[status] || colours.pending}`}>
      {label || status}
    </span>
  )
}
