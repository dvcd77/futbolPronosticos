import { createContext, useContext, useState, useCallback } from 'react';
import { DEFAULT_WEIGHTS } from '../models/ensemble.js';

const AppContext = createContext(null);

// Equipos clasificados al Mundial 2026 (lista oficial FIFA, 48 equipos)
// Ordenados alfabéticamente · Fuente: FIFA.com — junio 2026
// IDs: football-data.org (conocidos) o únicos de fallback (prefijo 9xx)
export const FALLBACK_TEAMS = [
  // ── UEFA (16) ───────────────────────────────────────────────────────────────
  { id: 758,  name: 'Alemania',            shortName: 'GER', tla: 'GER', conf: 'UEFA' },
  { id: 816,  name: 'Austria',             shortName: 'AUT', tla: 'AUT', conf: 'UEFA' },
  { id: 805,  name: 'Bélgica',             shortName: 'BEL', tla: 'BEL', conf: 'UEFA' },
  { id: 901,  name: 'Bosnia y Herzegovina',shortName: 'BIH', tla: 'BIH', conf: 'UEFA' },
  { id: 902,  name: 'Chequia',             shortName: 'CZE', tla: 'CZE', conf: 'UEFA' },
  { id: 779,  name: 'Croacia',             shortName: 'CRO', tla: 'CRO', conf: 'UEFA' },
  { id: 903,  name: 'Escocia',             shortName: 'SCO', tla: 'SCO', conf: 'UEFA' },
  { id: 759,  name: 'España',              shortName: 'ESP', tla: 'ESP', conf: 'UEFA' },
  { id: 760,  name: 'Francia',             shortName: 'FRA', tla: 'FRA', conf: 'UEFA' },
  { id: 770,  name: 'Inglaterra',          shortName: 'ENG', tla: 'ENG', conf: 'UEFA' },
  { id: 768,  name: 'Países Bajos',        shortName: 'NED', tla: 'NED', conf: 'UEFA' },
  { id: 769,  name: 'Portugal',            shortName: 'POR', tla: 'POR', conf: 'UEFA' },
  { id: 904,  name: 'Noruega',             shortName: 'NOR', tla: 'NOR', conf: 'UEFA' },
  { id: 905,  name: 'Suecia',              shortName: 'SWE', tla: 'SWE', conf: 'UEFA' },
  { id: 775,  name: 'Suiza',               shortName: 'SUI', tla: 'SUI', conf: 'UEFA' },
  { id: 818,  name: 'Turquía',             shortName: 'TUR', tla: 'TUR', conf: 'UEFA' },

  // ── CONMEBOL (6) ────────────────────────────────────────────────────────────
  { id: 764,  name: 'Argentina',           shortName: 'ARG', tla: 'ARG', conf: 'CONMEBOL' },
  { id: 762,  name: 'Brasil',              shortName: 'BRA', tla: 'BRA', conf: 'CONMEBOL' },
  { id: 763,  name: 'Colombia',            shortName: 'COL', tla: 'COL', conf: 'CONMEBOL' },
  { id: 798,  name: 'Ecuador',             shortName: 'ECU', tla: 'ECU', conf: 'CONMEBOL' },
  { id: 820,  name: 'Paraguay',            shortName: 'PAR', tla: 'PAR', conf: 'CONMEBOL' },
  { id: 773,  name: 'Uruguay',             shortName: 'URU', tla: 'URU', conf: 'CONMEBOL' },

  // ── CONCACAF — anfitriones (3) ──────────────────────────────────────────────
  { id: 828,  name: 'Canadá',              shortName: 'CAN', tla: 'CAN', conf: 'CONCACAF' },
  { id: 788,  name: 'México',              shortName: 'MEX', tla: 'MEX', conf: 'CONCACAF' },
  { id: 765,  name: 'Estados Unidos',      shortName: 'USA', tla: 'USA', conf: 'CONCACAF' },

  // ── CONCACAF — clasificados (3) ─────────────────────────────────────────────
  { id: 906,  name: 'Curaçao',             shortName: 'CUW', tla: 'CUW', conf: 'CONCACAF' },
  { id: 907,  name: 'Haití',               shortName: 'HAI', tla: 'HAI', conf: 'CONCACAF' },
  { id: 824,  name: 'Panamá',              shortName: 'PAN', tla: 'PAN', conf: 'CONCACAF' },

  // ── AFC (9) ─────────────────────────────────────────────────────────────────
  { id: 793,  name: 'Arabia Saudita',      shortName: 'KSA', tla: 'KSA', conf: 'AFC' },
  { id: 786,  name: 'Australia',           shortName: 'AUS', tla: 'AUS', conf: 'AFC' },
  { id: 794,  name: 'Irán',                shortName: 'IRN', tla: 'IRN', conf: 'AFC' },
  { id: 908,  name: 'Iraq',                shortName: 'IRQ', tla: 'IRQ', conf: 'AFC' },
  { id: 791,  name: 'Japón',               shortName: 'JPN', tla: 'JPN', conf: 'AFC' },
  { id: 831,  name: 'Jordania',            shortName: 'JOR', tla: 'JOR', conf: 'AFC' },
  { id: 800,  name: 'Corea del Sur',       shortName: 'KOR', tla: 'KOR', conf: 'AFC' },
  { id: 909,  name: 'Qatar',               shortName: 'QAT', tla: 'QAT', conf: 'AFC' },
  { id: 830,  name: 'Uzbekistán',          shortName: 'UZB', tla: 'UZB', conf: 'AFC' },

  // ── CAF (10) ────────────────────────────────────────────────────────────────
  { id: 832,  name: 'Argelia',             shortName: 'ALG', tla: 'ALG', conf: 'CAF' },
  { id: 910,  name: 'Cabo Verde',          shortName: 'CPV', tla: 'CPV', conf: 'CAF' },
  { id: 911,  name: 'Congo RD',            shortName: 'COD', tla: 'COD', conf: 'CAF' },
  { id: 912,  name: 'Costa de Marfil',     shortName: 'CIV', tla: 'CIV', conf: 'CAF' },
  { id: 826,  name: 'Egipto',              shortName: 'EGY', tla: 'EGY', conf: 'CAF' },
  { id: 803,  name: 'Ghana',               shortName: 'GHA', tla: 'GHA', conf: 'CAF' },
  { id: 784,  name: 'Marruecos',           shortName: 'MAR', tla: 'MAR', conf: 'CAF' },
  { id: 772,  name: 'Senegal',             shortName: 'SEN', tla: 'SEN', conf: 'CAF' },
  { id: 913,  name: 'Sudáfrica',           shortName: 'RSA', tla: 'RSA', conf: 'CAF' },
  { id: 810,  name: 'Túnez',               shortName: 'TUN', tla: 'TUN', conf: 'CAF' },

  // ── OFC (1) ─────────────────────────────────────────────────────────────────
  { id: 829,  name: 'Nueva Zelanda',       shortName: 'NZL', tla: 'NZL', conf: 'OFC' },
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
