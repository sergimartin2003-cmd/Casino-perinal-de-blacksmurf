// Arreglos de apuestas deportivas:
//  1) El updater pide primero los PRÓXIMOS (status=pending) y cae a sin filtro.
//  2) getUserBets usa LEFT JOIN: la apuesta no desaparece si su evento se limpió.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const SportsUpdater = require('../src/sportsUpdater');
const SportsCache = require('../src/sportsCache');
const SportsBetting = require('../src/sportsBetting');

let f = 0; const A = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) f++; };
const schema = fs.readFileSync(path.join(__dirname, '..', 'migrations/sports_tables.sql'), 'utf8');
const future = new Date(Date.now() + 3 * 3600000).toISOString();
const ODDS = (ids) => [{ id: ids[0], bookmakers: [{ name: 'Bet365', markets: [{ name: 'ML', odds: [{ home: 1.9, draw: 3.5, away: 4 }] }] }] }];

function mkUpdater() {
  const up = new SportsUpdater('FAKE', ':memory:');
  up.cache.db.exec(schema);
  up.api.getBookmakers = async () => ([{ name: 'Bet365' }, { name: 'Stake' }]);
  up.api.getOddsMulti = async (ids) => ODDS(ids);
  return up;
}

(async () => {
  // 1a) Cuando 'pending' devuelve próximos, se usan esos (no se llama al fallback).
  console.log('\nTEST 1 — pide status=pending primero');
  {
    const up = mkUpdater();
    const calls = [];
    up.api.getEvents = async (sport, league, limit, status) => {
      calls.push(status);
      if (status === 'pending') return [{ id: 1, home: 'A', away: 'B', date: future, status: 'scheduled', league: { name: 'L' } }];
      return []; // sin filtro no devolvería nada
    };
    const res = await up.updateSport('football', []);
    A(calls[0] === 'pending', 'la primera llamada de eventos usa status=pending');
    A(res.updated === 1, 'guarda el evento próximo');
  }

  // 1b) Si 'pending' no da nada (plan no lo soporta), cae a la petición sin filtro.
  console.log('\nTEST 2 — fallback a sin filtro si pending vacío');
  {
    const up = mkUpdater();
    const calls = [];
    up.api.getEvents = async (sport, league, limit, status) => {
      calls.push(status);
      if (status === 'pending') return [];
      return [{ id: 2, home: 'C', away: 'D', date: future, status: 'scheduled', league: { name: 'L' } }];
    };
    const res = await up.updateSport('football', []);
    A(calls.includes('pending') && calls.includes(undefined), 'tras pending vacío, pide sin filtro');
    A(res.updated === 1, 'guarda el evento del fallback');
  }

  // 2) La limpieza NO peta con eventos que tienen apuestas (FK activas) y los
  //    conserva; los eventos viejos SIN apuestas sí se borran.
  console.log('\nTEST 3 — limpieza no peta con apuestas y conserva el historial');
  {
    const SportsCleanup = require('../src/sportsCleanup');
    const dbPath = path.join(os.tmpdir(), `sportsfix_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
    const raw = new Database(dbPath);
    raw.exec(schema);
    raw.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, balance INTEGER DEFAULT 0)');
    raw.prepare('INSERT INTO users (id, balance) VALUES (?, ?)').run('U', 1000);
    raw.close();

    const cache = new SportsCache(dbPath);
    const betting = new SportsBetting(dbPath);
    const cleanup = new SportsCleanup(dbPath, null);
    const oldDate = new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString();

    cache.saveEvents([{ id: 'EVB', league: 'L', home_team: 'A', away_team: 'B', start_time: oldDate, status: 'scheduled' }], 'football');
    betting.placeBet('U', 'EVB', 'moneyline', 'home', 1.9, 100); // evento CON apuesta
    cache.updateEventStatus('EVB', 'finished', 2, 1);
    cache.saveEvents([{ id: 'EVN', league: 'L', home_team: 'C', away_team: 'D', start_time: oldDate, status: 'scheduled' }], 'football');
    cache.updateEventStatus('EVN', 'finished', 1, 0); // evento SIN apuesta

    let threw = false;
    try { await cleanup.cleanupOldEvents(7); } catch (e) { threw = true; console.error('   ->', e.message); }
    A(!threw, 'la limpieza NO peta aunque un evento tenga apuestas (antes: FOREIGN KEY constraint)');
    A(!!cache.getEventById('EVB'), 'conserva el evento con apuestas');
    A(!cache.getEventById('EVN'), 'borra el evento viejo SIN apuestas');
    A(betting.getUserBets('U').length === 1, 'la apuesta sigue en el historial');

    try { fs.unlinkSync(dbPath); } catch {}
  }

  console.log('\n' + (f === 0 ? '✅ SPORTS-INPUT OK' : `❌ ${f} fallan`));
  process.exit(f === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR TEST:', e); process.exit(1); });
