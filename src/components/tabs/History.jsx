import { useState } from 'react';
import { useApp } from '../../context/AppContext.jsx';
import { EmptyState, SectionTitle } from '../ui/Shared.jsx';
import { MODEL_LABELS } from '../../models/ensemble.js';

function ResultPill({ value, color, label }) {
  return (
    <span style={{
      fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color,
      background: color + '22', borderRadius: 4, padding: '2px 8px',
    }}>
      {label}: {(value * 100).toFixed(1)}%
    </span>
  );
}

function HistoryEntry({ entry, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const { homeTeam, awayTeam, model, result, date } = entry;
  const dateStr = new Date(date).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

  const maxProb = Math.max(result.home, result.draw, result.away);
  const winner = maxProb === result.home ? homeTeam : maxProb === result.away ? awayTeam : 'Empate';
  const winnerColor = maxProb === result.home ? '#00D4AA' : maxProb === result.away ? '#F5A623' : '#7AACCC';

  return (
    <div className="card-sm" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {/* Teams */}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            <span style={{ color: '#00D4AA' }}>{homeTeam}</span>
            <span style={{ color: '#3a5070', margin: '0 8px' }}>vs</span>
            <span style={{ color: '#F5A623' }}>{awayTeam}</span>
          </div>
          <div style={{ fontSize: 11, color: '#3a5070', marginTop: 3 }}>
            {MODEL_LABELS[model] ?? model} · {dateStr}
          </div>
        </div>

        {/* Favorite */}
        <div style={{ fontSize: 12, color: winnerColor, fontWeight: 600 }}>
          Favorito: {winner}
        </div>

        {/* Quick 1X2 */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <ResultPill value={result.home} color="#00D4AA" label="1" />
          <ResultPill value={result.draw} color="#7AACCC" label="X" />
          <ResultPill value={result.away} color="#F5A623" label="2" />
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setExpanded(!expanded)} style={{
            background: 'transparent', border: '1px solid #162844', borderRadius: 6,
            padding: '4px 10px', fontSize: 11, color: '#5a7a9a', cursor: 'pointer',
          }}>
            {expanded ? '▲' : '▼'}
          </button>
          <button onClick={() => onDelete(entry.id)} style={{
            background: 'transparent', border: '1px solid #2e0d0d', borderRadius: 6,
            padding: '4px 10px', fontSize: 11, color: '#F85149', cursor: 'pointer',
          }}>✕</button>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ borderTop: '1px solid #162844', marginTop: 12, paddingTop: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
            {[
              { label: 'xG Local', val: result.lambdaHome?.toFixed(2), color: '#00D4AA' },
              { label: 'xG Visita', val: result.lambdaAway?.toFixed(2), color: '#F5A623' },
              { label: 'Over 2.5', val: result.over?.['2.5'] ? `${(result.over['2.5']*100).toFixed(1)}%` : null, color: '#3FB950' },
              { label: 'BTTS', val: result.btts ? `${(result.btts*100).toFixed(1)}%` : null, color: '#BC8CFF' },
              { label: 'Sims', val: result.totalSims?.toLocaleString(), color: '#5a7a9a' },
            ].filter(d => d.val).map(({ label, val, color }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#3a5070', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace', color }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function History() {
  const { history, removeFromHistory, clearHistory } = useApp();
  const [filter, setFilter] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = filter.trim()
    ? history.filter(e =>
        e.homeTeam.toLowerCase().includes(filter.toLowerCase()) ||
        e.awayTeam.toLowerCase().includes(filter.toLowerCase())
      )
    : history;

  function exportCSV() {
    const header = 'Fecha,Local,Visitante,Modelo,Prob1,ProbX,Prob2,xGLocal,xGVisita,Over25,BTTS\n';
    const rows = history.map(e => [
      new Date(e.date).toLocaleString('es-CO'),
      e.homeTeam, e.awayTeam,
      MODEL_LABELS[e.model] ?? e.model,
      (e.result.home * 100).toFixed(1),
      (e.result.draw * 100).toFixed(1),
      (e.result.away * 100).toFixed(1),
      e.result.lambdaHome?.toFixed(2) ?? '',
      e.result.lambdaAway?.toFixed(2) ?? '',
      e.result.over?.['2.5'] ? (e.result.over['2.5'] * 100).toFixed(1) : '',
      e.result.btts ? (e.result.btts * 100).toFixed(1) : '',
    ].join(',')).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'pronosticos-mundial-2026.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <SectionTitle>Historial de pronósticos ({history.length})</SectionTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          {history.length > 0 && (
            <>
              <button className="btn-secondary" onClick={exportCSV}>
                📥 Exportar CSV
              </button>
              {!confirmClear ? (
                <button className="btn-secondary" onClick={() => setConfirmClear(true)}
                  style={{ borderColor: '#4a1a1a', color: '#F85149' }}>
                  🗑 Limpiar
                </button>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { clearHistory(); setConfirmClear(false); }}
                    style={{ background: '#4a1a1a', color: '#F85149', border: 'none', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
                    Confirmar
                  </button>
                  <button onClick={() => setConfirmClear(false)}
                    style={{ background: 'transparent', color: '#5a7a9a', border: '1px solid #162844', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12 }}>
                    Cancelar
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Filter */}
      {history.length > 0 && (
        <div style={{ marginBottom: 16, position: 'relative' }}>
          <input type="text" placeholder="Filtrar por equipo..." value={filter} onChange={e => setFilter(e.target.value)} />
          {filter && (
            <button onClick={() => setFilter('')} style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
              background: 'transparent', border: 'none', color: '#5a7a9a', cursor: 'pointer', fontSize: 16,
            }}>×</button>
          )}
        </div>
      )}

      {history.length === 0 ? (
        <EmptyState icon="📋" title="Sin pronósticos guardados"
          sub="Haz una predicción en la pestaña Pronóstico y pulsa Guardar" />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title={`Sin resultados para "${filter}"`}
          sub="Intenta con otro nombre de equipo" />
      ) : (
        filtered.map(entry => (
          <HistoryEntry key={entry.id} entry={entry} onDelete={removeFromHistory} />
        ))
      )}
    </div>
  );
}
