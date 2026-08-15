// Mecánica de apuestas deportivas: colocar (descuenta saldo, registra) y liquidar
// (paga apuesta×cuota al que acierta, no paga al que falla). BD temporal propia.
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const SportsCache = require('../src/sportsCache');
const SportsBetting = require('../src/sportsBetting');
const { resolveBet } = require('../src/lib/bet');

let failures = 0;
const assert = (cond, label) => { console.log((cond ? '  ✅ ' : '  ❌ ') + label); if (!cond) failures++; };

const dbPath = path.join(os.tmpdir(), `bettest_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
const raw = new Database(dbPath);
raw.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations/sports_tables.sql'), 'utf8'));
raw.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, balance INTEGER DEFAULT 0)');
raw.prepare('INSERT INTO users (id, balance) VALUES (?, ?)').run('U1', 1000);
const cache = new SportsCache(dbPath);
const inFuture = new Date(Date.now() + 3 * 3600000).toISOString();
cache.saveEvents([{ id: 'E1', league: 'La Liga', home_team: 'Barcelona', away_team: 'Madrid', start_time: inFuture, status: 'scheduled' }], 'football');
cache.saveOdds([{ event_id: 'E1', bookmaker: 'Bet365', market_type: 'moneyline', odds: { home: 1.90, draw: 3.50, away: 4.00 } }]);
raw.close();

const betting = new SportsBetting(dbPath);

(async () => {
  const formatted = cache.getFormattedOdds('E1');
  const ml = formatted.markets[Object.keys(formatted.markets)[0]].moneyline;
  assert(ml.home === 1.9 && ml.away === 4.0, 'el panel lee la cuota (home 1.90 / away 4.00)');

  const r = resolveBet('100', betting.getUserBalance('U1'));
  assert(!r.error && r.amount === 100, 'resolveBet acepta "100"');
  const bet = betting.placeBet('U1', 'E1', 'moneyline', 'home', ml.home, r.amount);
  assert(bet.potentialWinnings === 190, 'ganancia potencial = 100 × 1.90 = 190');
  assert(betting.getUserBalance('U1') === 900, 'descuenta 100 del saldo (1000 -> 900)');

  let threw = false;
  try { betting.placeBet('U1', 'E1', 'moneyline', 'away', ml.away, 999999); } catch { threw = true; }
  assert(threw, 'rechaza apuesta sin saldo suficiente');

  const res = betting.settleEventBets('E1', 'home');
  assert(res.won === 1 && res.totalPayout === 190, 'paga 190 al acertante');
  assert(betting.getUserBalance('U1') === 1090, 'saldo final 900 + 190 = 1090');

  betting.placeBet('U1', 'E1', 'moneyline', 'away', ml.away, 50);
  const balAfterBet = betting.getUserBalance('U1');
  betting.settleEventBets('E1', 'home');
  assert(betting.getUserBalance('U1') === balAfterBet, 'la apuesta perdedora no devuelve nada');

  try { fs.unlinkSync(dbPath); } catch {}
  console.log('\n' + (failures === 0 ? '✅ BETTING OK' : `❌ ${failures} fallan`));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR TEST:', e); try { fs.unlinkSync(dbPath); } catch {} process.exit(1); });
