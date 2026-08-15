// Formato REAL de odds-api.io: event.bookmakers[] -> {name, markets[]};
// market.name==='ML'; odds:[{home,draw,away}]. Verifica fetch -> parseo ->
// guardar -> lectura tal cual la usa el panel (getFormattedOdds).
const path = require('path');
const fs = require('fs');
const SportsUpdater = require('../src/sportsUpdater');

let failures = 0;
const assert = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) failures++; };

function mkUpdater() {
  const up = new SportsUpdater('FAKE_KEY', ':memory:');
  up.cache.db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations/sports_tables.sql'), 'utf8'));
  up.api.getBookmakers = async () => ([{ name: 'Bet365' }, { name: 'Stake' }]);
  up.api.getEvents = async () => ([{
    id: 72526268,
    league: { name: 'Premier League', slug: 'england-premier-league' },
    home: 'Arsenal', away: 'Chelsea',
    date: new Date(Date.now() + 3 * 3600000).toISOString(),
    status: 'scheduled',
  }]);
  return up;
}

const REAL_ODDS_RESPONSE = [{
  id: 72526268,
  home: 'Arsenal', away: 'Chelsea',
  bookmakers: [
    { name: 'Bet365', markets: [
      { name: 'ML', odds: [{ home: 1.9, draw: 3.5, away: 4.0 }] },
      { name: 'Totals', odds: [{ over: 1.8, under: 2.0 }] },
    ] },
    { name: 'Stake', markets: [{ name: 'ML', odds: [{ home: 1.88, draw: 3.6, away: 4.1 }] }] },
  ],
}];

(async () => {
  console.log('\nTEST A — _parseOddsResponse con la forma real (ML + odds[0])');
  {
    const rows = mkUpdater()._parseOddsResponse(REAL_ODDS_RESPONSE);
    assert(rows.length === 2, 'saca 2 casas (Bet365 + Stake)');
    const b365 = rows.find((r) => r.bookmaker === 'Bet365');
    assert(b365 && b365.odds.home === 1.9 && b365.odds.draw === 3.5 && b365.odds.away === 4.0, 'Bet365 home/draw/away correctos');
  }

  console.log('\nTEST B — updateSport guarda cuotas y el panel las lee (moneyline)');
  {
    const up = mkUpdater();
    up.api.getOddsMulti = async () => REAL_ODDS_RESPONSE;
    const res = await up.updateSport('football', []);
    assert(res.odds === 2, 'updateSport reporta 2 cuotas');
    const formatted = up.cache.getFormattedOdds('72526268');
    const firstBk = formatted && formatted.markets && Object.keys(formatted.markets)[0];
    const ml = (firstBk && formatted.markets[firstBk].moneyline) || {};
    assert(!!ml.home && !!ml.away, 'el panel obtiene home y away (=> aparecen botones)');
    assert(!!ml.draw, 'el panel obtiene empate (=> botón Empate)');
  }

  console.log('\nTEST C — tolera variante: bookmakers/markets como objeto y odds como objeto');
  {
    const variant = [{ id: 999, bookmakers: { Bet365: { markets: { '1X2': { home: 2.1, draw: 3.2, away: 3.3 } } } } }];
    const rows = mkUpdater()._parseOddsResponse(variant);
    assert(rows.length === 1 && rows[0].odds.home === 2.1 && rows[0].odds.away === 3.3, 'parsea la variante en objeto');
  }

  console.log('\n' + (failures === 0 ? '✅ ODDS OK' : `❌ ${failures} fallan`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR TEST:', e); process.exit(1); });
