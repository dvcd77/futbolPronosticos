import { createContext, useContext, useState, useCallback } from 'react';
import { DEFAULT_WEIGHTS } from '../models/ensemble.js';

const AppContext = createContext(null);

// Fallback WC 2026 teams if API is unavailable
export const FALLBACK_TEAMS = [
  { id: 762, name: 'Brasil', shortName: 'BRA', tla: 'BRA', crest: '' },
  { id: 764, name: 'Argentina', shortName: 'ARG', tla: 'ARG', crest: '' },
  { id: 760, name: 'Francia', shortName: 'FRA', tla: 'FRA', crest: '' },
  { id: 759, name: 'España', shortName: 'ESP', tla: 'ESP', crest: '' },
  { id: 758, name: 'Alemania', shortName: 'GER', tla: 'GER', crest: '' },
  { id: 770, name: 'Inglaterra', shortName: 'ENG', tla: 'ENG', crest: '' },
  { id: 765, name: 'Estados Unidos', shortName: 'USA', tla: 'USA', crest: '' },
  { id: 788, name: 'México', shortName: 'MEX', tla: 'MEX', crest: '' },
  { id: 828, name: 'Canadá', shortName: 'CAN', tla: 'CAN', crest: '' },
  { id: 763, name: 'Colombia', shortName: 'COL', tla: 'COL', crest: '' },
  { id: 773, name: 'Uruguay', shortName: 'URU', tla: 'URU', crest: '' },
  { id: 769, name: 'Portugal', shortName: 'POR', tla: 'POR', crest: '' },
  { id: 768, name: 'Países Bajos', shortName: 'NED', tla: 'NED', crest: '' },
  { id: 773, name: 'Bélgica', shortName: 'BEL', tla: 'BEL', crest: '' },
  { id: 779, name: 'Croacia', shortName: 'CRO', tla: 'CRO', crest: '' },
  { id: 784, name: 'Marruecos', shortName: 'MAR', tla: 'MAR', crest: '' },
  { id: 791, name: 'Japón', shortName: 'JPN', tla: 'JPN', crest: '' },
  { id: 772, name: 'Senegal', shortName: 'SEN', tla: 'SEN', crest: '' },
  { id: 786, name: 'Australia', shortName: 'AUS', tla: 'AUS', crest: '' },
  { id: 775, name: 'Suiza', shortName: 'SUI', tla: 'SUI', crest: '' },
  { id: 778, name: 'Polonia', shortName: 'POL', tla: 'POL', crest: '' },
  { id: 782, name: 'Dinamarca', shortName: 'DEN', tla: 'DEN', crest: '' },
  { id: 800, name: 'Corea del Sur', shortName: 'KOR', tla: 'KOR', crest: '' },
  { id: 798, name: 'Ecuador', shortName: 'ECU', tla: 'ECU', crest: '' },
  { id: 793, name: 'Arabia Saudita', shortName: 'KSA', tla: 'KSA', crest: '' },
  { id: 794, name: 'Irán', shortName: 'IRN', tla: 'IRN', crest: '' },
  { id: 801, name: 'Nigeria', shortName: 'NGA', tla: 'NGA', crest: '' },
  { id: 803, name: 'Ghana', shortName: 'GHA', tla: 'GHA', crest: '' },
  { id: 810, name: 'Túnez', shortName: 'TUN', tla: 'TUN', crest: '' },
  { id: 804, name: 'Camerún', shortName: 'CMR', tla: 'CMR', crest: '' },
  { id: 815, name: 'Serbia', shortName: 'SRB', tla: 'SRB', crest: '' },
  { id: 816, name: 'Austria', shortName: 'AUT', tla: 'AUT', crest: '' },
  { id: 817, name: 'Italia', shortName: 'ITA', tla: 'ITA', crest: '' },
  { id: 818, name: 'Turquía', shortName: 'TUR', tla: 'TUR', crest: '' },
  { id: 820, name: 'Paraguay', shortName: 'PAR', tla: 'PAR', crest: '' },
  { id: 821, name: 'Venezuela', shortName: 'VEN', tla: 'VEN', crest: '' },
  { id: 822, name: 'Costa Rica', shortName: 'CRC', tla: 'CRC', crest: '' },
  { id: 823, name: 'Jamaica', shortName: 'JAM', tla: 'JAM', crest: '' },
  { id: 824, name: 'Panamá', shortName: 'PAN', tla: 'PAN', crest: '' },
  { id: 825, name: 'Bolivia', shortName: 'BOL', tla: 'BOL', crest: '' },
  { id: 826, name: 'Egipto', shortName: 'EGY', tla: 'EGY', crest: '' },
  { id: 827, name: 'Mali', shortName: 'MLI', tla: 'MLI', crest: '' },
  { id: 829, name: 'Nueva Zelanda', shortName: 'NZL', tla: 'NZL', crest: '' },
  { id: 830, name: 'Uzbekistán', shortName: 'UZB', tla: 'UZB', crest: '' },
  { id: 831, name: 'Jordania', shortName: 'JOR', tla: 'JOR', crest: '' },
  { id: 832, name: 'Argelia', shortName: 'ALG', tla: 'ALG', crest: '' },
  { id: 833, name: 'Eslovaquia', shortName: 'SVK', tla: 'SVK', crest: '' },
  { id: 834, name: 'Rep. Checa', shortName: 'CZE', tla: 'CZE', crest: '' },
];

export function AppProvider({ children }) {
  const [teams, setTeams] = useState([]);
  const [teamMatchCache, setTeamMatchCache] = useState({});
  const [eloRatings, setEloRatings] = useState(new Map());
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [simCount, setSimCount] = useState(20000);
  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('wc_history') || '[]'); }
    catch { return []; }
  });
  const [apiStatus, setApiStatus] = useState({ ok: null, queue: 0 });

  const addToHistory = useCallback((entry) => {
    setHistory(prev => {
      const next = [{ ...entry, id: Date.now() }, ...prev].slice(0, 100);
      try { localStorage.setItem('wc_history', JSON.stringify(next)); } catch { }
      return next;
    });
  }, []);

  const removeFromHistory = useCallback((id) => {
    setHistory(prev => {
      const next = prev.filter(e => e.id !== id);
      try { localStorage.setItem('wc_history', JSON.stringify(next)); } catch { }
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem('wc_history');
  }, []);

  return (
    <AppContext.Provider value={{
      teams, setTeams,
      teamMatchCache, setTeamMatchCache,
      eloRatings, setEloRatings,
      weights, setWeights,
      simCount, setSimCount,
      history, addToHistory, removeFromHistory, clearHistory,
      apiStatus, setApiStatus,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
