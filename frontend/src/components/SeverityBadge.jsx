const colours = {
  Critical:    'bg-red-100 text-red-800 border border-red-200',
  High:        'bg-orange-100 text-orange-800 border border-orange-200',
  Medium:      'bg-blue-100 text-blue-800 border border-blue-200',
  Low:         'bg-green-100 text-green-800 border border-green-200',
  Observation: 'bg-gray-100 text-gray-600 border border-gray-200',
}

export default function SeverityBadge({ severity }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${colours[severity] || colours.Observation}`}>
      {severity}
    </span>
  )
}
