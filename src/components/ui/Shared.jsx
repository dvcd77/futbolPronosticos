// ── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      style={{ animation: 'spin 0.9s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="10" stroke="#1C3254" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#00D4AA" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ── Probability number with std dev badge ────────────────────────────────────
export function ProbBadge({ value, std, color = '#00D4AA', size = 'md' }) {
  const pct = (value * 100).toFixed(1);
  const stdPct = std != null ? (std * 100).toFixed(1) : null;
  const fontSize = size === 'lg' ? 28 : size === 'sm' ? 14 : 20;
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize, fontWeight: 700, color }}>
        {pct}%
      </div>
      {stdPct && (
        <div className="std-badge" style={{ marginTop: 3 }}>±{stdPct}%</div>
      )}
    </div>
  );
}

// ── Horizontal probability bar ────────────────────────────────────────────────
export function ProbBar({ label, value, std, color, showPct = true, height = 8 }) {
  const pct = Math.round(value * 100 * 10) / 10;
  const stdPct = std != null ? (std * 100).toFixed(1) : null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
        <span style={{ color: '#7AACCC' }}>{label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {showPct && <span style={{ fontFamily: 'monospace', fontWeight: 600, color }}>{pct}%</span>}
          {stdPct && <span className="std-badge">±{stdPct}%</span>}
        </span>
      </div>
      <div style={{ background: '#162844', borderRadius: 4, height, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 4,
          background: color, transition: 'width 0.7s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
    </div>
  );
}

// ── Team selector dropdown with confederation grouping ────────────────────────
export function TeamSelector({ teams, value, onChange, label, excludeId }) {
  const available = teams.filter(t => t.id !== excludeId);

  // Group by confederation
  const confOrder = ['UEFA', 'CONMEBOL', 'CONCACAF', 'AFC', 'CAF', 'OFC'];
  const confLabel = {
    UEFA: '🇪🇺 UEFA', CONMEBOL: '🌎 CONMEBOL', CONCACAF: '🌎 CONCACAF',
    AFC: '🌏 AFC', CAF: '🌍 CAF', OFC: '🌊 OFC',
  };
  const grouped = {};
  available.forEach(t => {
    const c = t.conf ?? 'Otros';
    if (!grouped[c]) grouped[c] = [];
    grouped[c].push(t);
  });

  return (
    <div>
      <div className="label-sm mb-2">{label}</div>
      <div style={{ position: 'relative' }}>
        <select value={value ?? ''} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">— Seleccionar equipo —</option>
          {confOrder.filter(c => grouped[c]).map(conf => (
            <optgroup key={conf} label={confLabel[conf] ?? conf}>
              {grouped[conf].sort((a, b) => a.name.localeCompare(b.name, 'es')).map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          pointerEvents: 'none', color: '#5a7a9a', fontSize: 12,
        }}>▼</div>
      </div>
    </div>
  );
}

// ── Section title ─────────────────────────────────────────────────────────────
export function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#7AACCC', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
        {children}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#3a5070', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <div style={{ color: '#7AACCC', fontWeight: 500, marginBottom: 6 }}>{title}</div>
      {sub && <div style={{ color: '#3a5070', fontSize: 13 }}>{sub}</div>}
    </div>
  );
}

// ── Error box ─────────────────────────────────────────────────────────────────
export function ErrorBox({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: '#2e0d0d', border: '1px solid #4a1a1a', borderRadius: 8,
      padding: '12px 16px', color: '#F85149', fontSize: 13, marginBottom: 16,
      display: 'flex', gap: 8, alignItems: 'flex-start',
    }}>
      <span style={{ fontSize: 16 }}>⚠️</span>
      <span>{message}</span>
    </div>
  );
}

// ── Info box ──────────────────────────────────────────────────────────────────
export function InfoBox({ message }) {
  if (!message) return null;
  return (
    <div style={{
      background: '#0d1e30', border: '1px solid #1a3a50', borderRadius: 8,
      padding: '12px 16px', color: '#7AACCC', fontSize: 13, marginBottom: 16,
    }}>
      ℹ️ {message}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, color }) {
  return (
    <div className="card-sm" style={{ textAlign: 'center' }}>
      <div className="label-sm" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? '#00D4AA', fontFamily: 'monospace' }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: '#3a5070', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}
