// Fuente de resultados reales: JSON público de ESPN (gratis, sin API key).
// Endpoint NO oficial: fiable casi siempre, pero podría cambiar sin avisar.
//
// kind:
//   'soccer' -> 1X2 (Local / Empate / Visitante), equipos
//   'team2'  -> 2 opciones (Local / Visitante), equipos, sin empate
//   'mma'    -> 2 opciones (luchador A / B); una "velada" tiene varios combates

const LEAGUES = {
  // ⚽ Fútbol (1X2)
  laliga: { name: 'LaLiga', path: 'soccer/esp.1', kind: 'soccer', emoji: '⚽' },
  laliga2: { name: 'LaLiga Hypermotion', path: 'soccer/esp.2', kind: 'soccer', emoji: '⚽' },
  premier: { name: 'Premier League', path: 'soccer/eng.1', kind: 'soccer', emoji: '⚽' },
  championship: { name: 'Championship (Ing.)', path: 'soccer/eng.2', kind: 'soccer', emoji: '⚽' },
  champions: { name: 'Champions League', path: 'soccer/uefa.champions', kind: 'soccer', emoji: '⚽' },
  europa: { name: 'Europa League', path: 'soccer/uefa.europa', kind: 'soccer', emoji: '⚽' },
  seriea: { name: 'Serie A', path: 'soccer/ita.1', kind: 'soccer', emoji: '⚽' },
  bundesliga: { name: 'Bundesliga', path: 'soccer/ger.1', kind: 'soccer', emoji: '⚽' },
  ligue1: { name: 'Ligue 1', path: 'soccer/fra.1', kind: 'soccer', emoji: '⚽' },
  portugal: { name: 'Primeira Liga (Por.)', path: 'soccer/por.1', kind: 'soccer', emoji: '⚽' },
  eredivisie: { name: 'Eredivisie (Hol.)', path: 'soccer/ned.1', kind: 'soccer', emoji: '⚽' },
  brasil: { name: 'Brasileirão', path: 'soccer/bra.1', kind: 'soccer', emoji: '⚽' },
  argentina: { name: 'Liga Argentina', path: 'soccer/arg.1', kind: 'soccer', emoji: '⚽' },
  ligamx: { name: 'Liga MX (Méx.)', path: 'soccer/mex.1', kind: 'soccer', emoji: '⚽' },
  mls: { name: 'MLS', path: 'soccer/usa.1', kind: 'soccer', emoji: '⚽' },
  libertadores: { name: 'Copa Libertadores', path: 'soccer/conmebol.libertadores', kind: 'soccer', emoji: '⚽' },
  // 🏀 Baloncesto (2 opciones)
  nba: { name: 'NBA', path: 'basketball/nba', kind: 'team2', emoji: '🏀' },
  wnba: { name: 'WNBA', path: 'basketball/wnba', kind: 'team2', emoji: '🏀' },
  euroleague: { name: 'Euroliga', path: 'basketball/euroleague', kind: 'team2', emoji: '🏀' },
  ncaab: { name: 'NCAA Basket (univ.)', path: 'basketball/mens-college-basketball', kind: 'team2', emoji: '🏀' },
  // 🏈 ⚾ 🏒 Otros deportes de equipo (2 opciones)
  nfl: { name: 'NFL', path: 'football/nfl', kind: 'team2', emoji: '🏈' },
  ncaaf: { name: 'NCAA Football (univ.)', path: 'football/college-football', kind: 'team2', emoji: '🏈' },
  mlb: { name: 'MLB (béisbol)', path: 'baseball/mlb', kind: 'team2', emoji: '⚾' },
  nhl: { name: 'NHL (hockey)', path: 'hockey/nhl', kind: 'team2', emoji: '🏒' },
  // 🥊 Deportes de combate (por combate, 2 luchadores)
  ufc: { name: 'UFC', path: 'mma/ufc', kind: 'mma', emoji: '🥊' },
  pfl: { name: 'PFL', path: 'mma/pfl', kind: 'mma', emoji: '🥊' },
  bellator: { name: 'Bellator', path: 'mma/bellator', kind: 'mma', emoji: '🥊' },
  // 🎾 Tenis (por partido, 2 jugadores)
  atp: { name: 'Tenis ATP', path: 'tennis/atp', kind: 'tennis', emoji: '🎾' },
  wta: { name: 'Tenis WTA', path: 'tennis/wta', kind: 'tennis', emoji: '🎾' },
};

/** Busca ligas por nombre/clave para el autocompletado (máx 25 resultados). */
function searchLeagues(query) {
  const q = (query || '').toLowerCase().trim();
  return Object.entries(LEAGUES)
    .filter(([key, lg]) => !q || lg.name.toLowerCase().includes(q) || key.includes(q))
    .slice(0, 25)
    .map(([key, lg]) => ({ name: `${lg.emoji} ${lg.name}`, value: key }));
}

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';

const hasDraw = (leagueKey) => LEAGUES[leagueKey]?.kind === 'soccer';
const leagueName = (leagueKey) => LEAGUES[leagueKey]?.name || leagueKey;

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

const yyyymmdd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

// ¿El deporte es de individuos (luchadores/tenistas) en vez de equipos?
const isIndividual = (kind) => kind === 'mma' || kind === 'tennis';

/** Todos los enfrentamientos de un evento según el deporte. */
function competitionsOf(event, kind) {
  if (kind === 'mma') return event.competitions || []; // velada = varios combates
  if (kind === 'tennis') return (event.groupings || []).flatMap((g) => g.competitions || []); // torneo = rondas de partidos
  return [event.competitions?.[0]].filter(Boolean); // fútbol/equipos = 1 partido
}

/** Nombres de los dos lados de un enfrentamiento según el tipo de deporte. */
function sidesOf(comp, kind) {
  const cs = comp.competitors || [];
  if (isIndividual(kind)) {
    return { a: cs[0], b: cs[1], nameA: cs[0]?.athlete?.displayName || 'A', nameB: cs[1]?.athlete?.displayName || 'B' };
  }
  const home = cs.find((c) => c.homeAway === 'home') || cs[0];
  const away = cs.find((c) => c.homeAway === 'away') || cs[1];
  return { a: home, b: away, nameA: home?.team?.displayName || 'Local', nameB: away?.team?.displayName || 'Visitante' };
}

/** Próximos enfrentamientos (no empezados) de una liga/velada. */
async function fetchFixtures(leagueKey) {
  const lg = LEAGUES[leagueKey];
  if (!lg) return [];
  try {
    const data = await getJson(`${BASE}/${lg.path}/scoreboard`);
    const out = [];
    for (const e of data.events || []) {
      for (const comp of competitionsOf(e, lg.kind)) {
        if (comp.status?.type?.state !== 'pre') continue; // solo lo que no ha empezado
        const { nameA, nameB } = sidesOf(comp, lg.kind);
        out.push({
          id: isIndividual(lg.kind) ? comp.id : e.id,
          home: nameA,
          away: nameB,
          date: comp.date ? Date.parse(comp.date) : e.date ? Date.parse(e.date) : null,
        });
      }
    }
    return out.slice(0, 20);
  } catch {
    return [];
  }
}

/** Localiza la competición (partido/combate) con ese id dentro de un scoreboard. */
function findCompetition(data, kind, id) {
  for (const e of data.events || []) {
    if (isIndividual(kind)) {
      const c = competitionsOf(e, kind).find((x) => String(x.id) === String(id));
      if (c) return c;
    } else if (String(e.id) === String(id)) {
      return e.competitions?.[0] || null;
    }
  }
  return null;
}

/**
 * Estado/resultado de un enfrentamiento concreto.
 * @returns {{ ok:false } | { ok:true, state, completed, canceled, voidResult, winnerIdx }}
 *  winnerIdx: fútbol 0=Local 1=Empate 2=Visitante · 2-opciones 0=A 1=B.
 */
async function fetchEventResult(leagueKey, id, dateMs) {
  const lg = LEAGUES[leagueKey];
  if (!lg) return { ok: false };
  const urls = [];
  if (dateMs) urls.push(`${BASE}/${lg.path}/scoreboard?dates=${yyyymmdd(dateMs)}`);
  urls.push(`${BASE}/${lg.path}/scoreboard`);

  for (const url of urls) {
    let data;
    try {
      data = await getJson(url);
    } catch {
      continue;
    }
    const comp = findCompetition(data, lg.kind, id);
    if (!comp) continue;

    const type = comp.status?.type || {};
    const name = (type.name || '').toUpperCase();
    const canceled = name.includes('CANCEL') || name.includes('POSTPON') || name.includes('ABAN');
    const { a, b } = sidesOf(comp, lg.kind);

    let winnerIdx = null;
    let voidResult = false;
    if (type.completed) {
      if (a?.winner) winnerIdx = 0;
      else if (b?.winner) winnerIdx = lg.kind === 'soccer' ? 2 : 1;
      else if (lg.kind === 'soccer') winnerIdx = 1; // empate
      else voidResult = true; // 2-opciones sin ganador (empate raro / sin resultado) → reembolso
    }
    return { ok: true, state: type.state || 'pre', completed: !!type.completed, canceled, voidResult, winnerIdx };
  }
  return { ok: false };
}

module.exports = { LEAGUES, hasDraw, leagueName, searchLeagues, fetchFixtures, fetchEventResult };
