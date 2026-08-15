// Lógica de bookmakers: selección + auto-corrección desde el 403 del plan.
const path = require('path');
const fs = require('fs');
const SportsUpdater = require('../src/sportsUpdater');

const REAL_403 = 'HTTP 403: {"error":"Access denied. You\'re allowed max 2 bookmakers. ' +
  'Allowed: Bet365, Stake. To reset your selections, use PUT /bookmakers/selected/clear?apiKey=YOUR_API_KEY ' +
  'or visit https://docs.odds-api.io/api-reference/bookmakers/clear-selected-bookmakers. Upgrade your plan at https://odds-api.io/manage"}';

function mkUpdater() {
  const up = new SportsUpdater('FAKE_KEY', ':memory:');
  up.cache.db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations/sports_tables.sql'), 'utf8'));
  up.api.getBookmakers = async () => ([
    { name: 'Bet365' }, { name: 'Stake' }, { name: '10BET' }, { name: 'Pinnacle' },
    { name: 'William Hill' }, { name: 'Unibet' },
  ]);
  up.api.getEvents = async () => ([{
    id: 72526268,
    league: { name: 'La Liga', slug: 'esp-laliga' },
    home: 'Barcelona', away: 'Real Madrid',
    date: new Date(Date.now() + 3600000).toISOString(),
    status: 'scheduled',
  }]);
  return up;
}

let failures = 0;
const assert = (cond, label) => { console.log((cond ? '  ✅ ' : '  ❌ ') + label); if (!cond) failures++; };
const ODDS = (ids) => [{ id: ids[0], bookmakers: [{ name: 'Bet365', markets: [{ name: 'ML', odds: [{ home: 1.85, draw: 3.4, away: 4.2 }] }] }] }];
const allowedOnly = (bms) => { const s = bms.split(',').map((x) => x.trim().toLowerCase()); return s.every((b) => ['bet365', 'stake'].includes(b)) && s.length <= 2; };

(async () => {
  console.log('\nTEST 0 — parsear "Allowed:" del 403 real');
  assert(mkUpdater()._parseAllowedBookmakers(REAL_403) === 'Bet365,Stake', 'extrae y normaliza a "Bet365,Stake"');

  console.log('\nTEST 1 — Stake,bet365 permitidas: 1 sola llamada, guarda cuotas');
  {
    const up = mkUpdater();
    const calls = [];
    up.api.getOddsMulti = async (ids, bms) => { calls.push(bms); if (!allowedOnly(bms)) throw new Error(REAL_403); return ODDS(ids); };
    const res = await up.updateSport('football', []);
    assert(calls.length === 1, 'una sola llamada de cuotas (sin reintento)');
    assert(!/william|unibet|10bet|pinnacle/i.test(calls[0]), 'no manda casas de más');
    assert(res.odds > 0, 'guarda cuotas');
  }

  console.log('\nTEST 2 — plan bloqueado: 403 -> aprende "Bet365,Stake" -> reintenta y recuerda');
  {
    const up = mkUpdater();
    up._bmFetched = true;
    up._bookmakers = 'Bet365,Stake,William Hill,Unibet';
    const calls = [];
    up.api.getOddsMulti = async (ids, bms) => { calls.push(bms); if (!allowedOnly(bms)) throw new Error(REAL_403); return ODDS(ids); };
    const res1 = await up.updateSport('football', []);
    assert(calls.length === 2, 'primer ciclo: intento + reintento');
    assert(/william|unibet/i.test(calls[0]) && !/william|unibet/i.test(calls[1]), 'reintenta solo con las permitidas');
    assert(up._allowedBookmakers === 'Bet365,Stake', 'aprende las permitidas');
    assert(res1.odds > 0, 'guarda cuotas tras corregir');
    calls.length = 0;
    const res2 = await up.updateSport('football', []);
    assert(calls.length === 1 && !/william|unibet/i.test(calls[0]), 'segundo ciclo: directo a las permitidas');
    assert(res2.odds > 0, 'sigue guardando cuotas');
  }

  console.log('\n' + (failures === 0 ? '✅ BOOKMAKERS OK' : `❌ ${failures} fallan`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR TEST:', e); process.exit(1); });
