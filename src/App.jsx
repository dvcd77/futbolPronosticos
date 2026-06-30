import { useState, useEffect } from 'react';
import { AppProvider, FALLBACK_TEAMS } from './context/AppContext.jsx';
import { useApp } from './context/AppContext.jsx';
import Header from './components/layout/Header.jsx';
import TabBar from './components/layout/TabBar.jsx';
import MatchPredictor from './components/tabs/MatchPredictor.jsx';
import ShotsPredictor from './components/tabs/ShotsPredictor.jsx';
import ModelComparison from './components/tabs/ModelComparison.jsx';
import Backtest from './components/tabs/Backtest.jsx';
import History from './components/tabs/History.jsx';
import Settings from './components/tabs/Settings.jsx';
import { hasApiKey } from './api/footballApi.js';
import { loadServerConfig } from './api/serverConfig.js';

function AppContent() {
  const [activeTab, setActiveTab] = useState('predictor');
  const { setTeams, setApiStatus } = useApp();

  useEffect(() => {
    setTeams(FALLBACK_TEAMS);
    // Carga la config del servidor (qué tokens compartidos provee) ANTES de
    // evaluar el estado de las APIs. Así, si el servidor tiene los tokens,
    // la app los reconoce sin que el usuario ingrese nada en este dispositivo.
    loadServerConfig().then(() => {
      setApiStatus({ ok: hasApiKey(), queue: 0 });
    });
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#070D1B' }}>
      <Header />
      <TabBar active={activeTab} onChange={setActiveTab} />
      <main>
        {activeTab === 'predictor'  && <MatchPredictor />}
        {activeTab === 'shots'      && <ShotsPredictor />}
        {activeTab === 'comparison' && <ModelComparison />}
        {activeTab === 'backtest'   && <Backtest />}
        {activeTab === 'history'    && <History />}
        {activeTab === 'settings'   && <Settings />}
      </main>
      <footer style={{
        borderTop: '1px solid #0d1726', padding: '16px 24px',
        textAlign: 'center', fontSize: 11, color: '#3a5070', marginTop: 40,
      }}>
        Pronosticador Mundial 2026 · Modelos estadísticos · Solo entretenimiento · No es consejo de apuestas
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
