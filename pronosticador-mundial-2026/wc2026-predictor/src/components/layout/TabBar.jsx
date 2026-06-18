const TABS = [
  { id: 'predictor',   label: 'Pronóstico',    icon: '🎯' },
  { id: 'shots',       label: 'Disparos',       icon: '⚡' },
  { id: 'comparison',  label: 'Comparar',       icon: '📊' },
  { id: 'history',     label: 'Historial',      icon: '📋' },
  { id: 'settings',    label: 'Config',         icon: '⚙️' },
];

export default function TabBar({ active, onChange }) {
  return (
    <nav style={{ background: '#0A1225', borderBottom: '1px solid #162844' }}>
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex overflow-x-auto hide-scrollbar" style={{ gap: '2px' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className="flex items-center gap-1.5 py-3 px-4 text-sm font-medium whitespace-nowrap border-b-2 transition-colors"
              style={{
                borderColor: active === tab.id ? '#00D4AA' : 'transparent',
                color: active === tab.id ? '#00D4AA' : '#5a7a9a',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              <span>{tab.icon}</span>
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
