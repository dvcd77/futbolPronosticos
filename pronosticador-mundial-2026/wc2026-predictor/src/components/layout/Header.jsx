import { useApp } from '../../context/AppContext.jsx';

export default function Header() {
  const { apiStatus, simCount } = useApp();

  return (
    <header style={{ background: '#0A1225', borderBottom: '1px solid #162844' }} className="sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="text-2xl">⚽</div>
          <div>
            <div className="font-bold text-sm tracking-wide" style={{ color: '#00D4AA' }}>
              MUNDIAL 2026
            </div>
            <div className="text-xs" style={{ color: '#3a5070', fontFamily: 'monospace', marginTop: 1 }}>
              Pronosticador IA
            </div>
          </div>
        </div>

        {/* Status pills */}
        <div className="flex items-center gap-2">
          {apiStatus.ok === true && (
            <span className="text-xs px-2 py-1 rounded-full flex items-center gap-1"
              style={{ background: '#0d2e1e', color: '#3FB950', border: '1px solid #1a4a2e' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
              API conectada
            </span>
          )}
          {apiStatus.ok === false && (
            <span className="text-xs px-2 py-1 rounded-full flex items-center gap-1"
              style={{ background: '#2e0d0d', color: '#F85149', border: '1px solid #4a1a1a' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block"></span>
              Sin API key
            </span>
          )}
          {apiStatus.queue > 0 && (
            <span className="text-xs px-2 py-1 rounded-full"
              style={{ background: '#2e200d', color: '#F5A623', border: '1px solid #4a3a1a' }}>
              Cola: {apiStatus.queue}
            </span>
          )}
          <span className="text-xs font-mono px-2 py-1 rounded"
            style={{ background: '#0d1a2e', color: '#3a5070' }}>
            {simCount.toLocaleString()} sims
          </span>
        </div>
      </div>
    </header>
  );
}
