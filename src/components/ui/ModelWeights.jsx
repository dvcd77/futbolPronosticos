import { MODEL_IDS, MODEL_LABELS } from '../../models/ensemble.js';

const MODEL_COLORS = {
  poisson: '#00D4AA',
  elo:     '#7AACCC',
  form:    '#F5A623',
  xg:      '#BC8CFF',
  ml:      '#3FB950',
  fifa:    '#FFD700',
};

export default function ModelWeights({ weights, onChange, mode, onModeChange }) {
  const total = MODEL_IDS.reduce((s, id) => s + (weights[id] ?? 0), 0);

  function handleSlider(id, val) {
    onChange({ ...weights, [id]: Math.round(val * 100) / 100 });
  }

  function resetEqual() {
    const eq = 1 / MODEL_IDS.length;
    const w = {};
    MODEL_IDS.forEach(id => { w[id] = Math.round(eq * 100) / 100; });
    onChange(w);
  }

  return (
    <div>
      {/* Mode switcher */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {['auto', 'manual'].map(m => (
          <button
            key={m}
            onClick={() => onModeChange(m)}
            className="model-tab"
            style={mode === m ? {
              background: '#112038', borderColor: '#00D4AA', color: '#00D4AA',
              border: '1px solid #00D4AA', borderRadius: 6, padding: '5px 14px',
              fontSize: 12, cursor: 'pointer', fontWeight: 500,
            } : {
              background: 'transparent', borderColor: '#162844', color: '#5a7a9a',
              border: '1px solid #162844', borderRadius: 6, padding: '5px 14px',
              fontSize: 12, cursor: 'pointer', fontWeight: 500,
            }}
          >
            {m === 'auto' ? '🔄 Auto' : '🎚 Manual'}
          </button>
        ))}
        {mode === 'manual' && (
          <button onClick={resetEqual} style={{
            background: 'transparent', border: '1px solid #162844', borderRadius: 6,
            padding: '5px 14px', fontSize: 11, color: '#3a5070', cursor: 'pointer', marginLeft: 'auto',
          }}>
            Igualar
          </button>
        )}
      </div>

      {mode === 'auto' ? (
        <div style={{ fontSize: 12, color: '#3a5070', padding: '10px 0' }}>
          Pesos iguales entre modelos disponibles (cada uno contribuye equitativamente).
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {MODEL_IDS.map(id => {
            const w = weights[id] ?? 0;
            const pct = total > 0 ? Math.round((w / total) * 100) : 0;
            return (
              <div key={id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: MODEL_COLORS[id] }}>
                    {MODEL_LABELS[id]}
                  </span>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#5a7a9a' }}>
                    {pct}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0" max="1" step="0.05"
                  value={w}
                  onChange={e => handleSlider(id, parseFloat(e.target.value))}
                />
              </div>
            );
          })}
          <div style={{ fontSize: 11, color: total > 0 ? '#3a5070' : '#F85149', paddingTop: 4 }}>
            {total > 0
              ? `Suma total: ${Math.round(total * 100)}% (se normaliza automáticamente)`
              : '⚠️ Al menos un modelo debe tener peso > 0'}
          </div>
        </div>
      )}
    </div>
  );
}
