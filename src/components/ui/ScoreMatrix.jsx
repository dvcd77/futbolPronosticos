/**
 * Score probability heatmap grid.
 * Rows = home goals (0…maxGoals from top to bottom)
 * Cols = away goals (0…maxGoals from left to right)
 */
export default function ScoreMatrix({ scores, maxGoals = 6, homeLabel = 'Local', awayLabel = 'Visitante' }) {
  if (!scores || Object.keys(scores).length === 0) return null;

  // Find max probability for color scaling
  let maxProb = 0;
  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = scores[`${h}-${a}`] ?? 0;
      if (p > maxProb) maxProb = p;
    }
  }

  // Sort top scores for the ranking list
  const topScores = Object.entries(scores)
    .filter(([k]) => {
      const [h, a] = k.split('-').map(Number);
      return h <= maxGoals && a <= maxGoals;
    })
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8);

  function cellColor(p) {
    if (p < 0.001) return { bg: '#0A1225', text: '#1C3254' };
    const t = Math.min(p / maxProb, 1);
    if (t > 0.75) return { bg: '#003d30', text: '#00D4AA' };
    if (t > 0.50) return { bg: '#002a22', text: '#00B894' };
    if (t > 0.25) return { bg: '#001a18', text: '#009679' };
    if (t > 0.10) return { bg: '#0D172E', text: '#5a7a9a' };
    return { bg: '#0A1225', text: '#1C3254' };
  }

  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      {/* Grid */}
      <div>
        {/* Column header: Away goals */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2, paddingLeft: 28 }}>
          <div style={{ fontSize: 9, color: '#3a5070', marginRight: 4 }}>{awayLabel} →</div>
          {Array.from({ length: maxGoals + 1 }, (_, a) => (
            <div key={a} style={{
              width: 36, textAlign: 'center', fontSize: 10,
              color: '#5a7a9a', fontFamily: 'monospace',
            }}>{a}</div>
          ))}
        </div>

        {/* Rows: Home goals */}
        {Array.from({ length: maxGoals + 1 }, (_, h) => (
          <div key={h} style={{ display: 'flex', alignItems: 'center' }}>
            {/* Row label */}
            <div style={{
              width: 28, textAlign: 'right', paddingRight: 4,
              fontSize: 10, color: '#5a7a9a', fontFamily: 'monospace',
            }}>{h}</div>
            {Array.from({ length: maxGoals + 1 }, (_, a) => {
              const p = scores[`${h}-${a}`] ?? 0;
              const { bg, text } = cellColor(p);
              const pct = p > 0.001 ? (p * 100).toFixed(1) : '';
              return (
                <div key={a} className="score-cell" style={{ background: bg, color: text }}>
                  {pct}
                </div>
              );
            })}
          </div>
        ))}

        {/* Row header: Home goals */}
        <div style={{ display: 'flex', paddingLeft: 28, marginTop: 2 }}>
          <div style={{ fontSize: 9, color: '#3a5070' }}>↑ {homeLabel}</div>
        </div>
      </div>

      {/* Top scores ranking */}
      <div style={{ flex: 1, minWidth: 140 }}>
        <div className="label-sm" style={{ marginBottom: 10 }}>Marcadores más probables</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {topScores.map(([score, prob], i) => {
            const [h, a] = score.split('-').map(Number);
            const pct = (prob * 100).toFixed(1);
            const col = h > a ? '#00D4AA' : h === a ? '#7AACCC' : '#F5A623';
            return (
              <div key={score} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, color: '#3a5070', fontFamily: 'monospace', width: 14 }}>
                  {i + 1}
                </span>
                <span style={{
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 14, fontWeight: 700,
                  color: col, minWidth: 36,
                }}>
                  {h}-{a}
                </span>
                <div style={{ flex: 1, background: '#162844', borderRadius: 3, height: 5 }}>
                  <div style={{
                    width: `${Math.min(pct * 3, 100)}%`, height: '100%',
                    borderRadius: 3, background: col, transition: 'width 0.6s',
                  }} />
                </div>
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#5a7a9a', minWidth: 38 }}>
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
