// P&L de apuestas deportivas del reporte diario (mismas queries que sportsSummary).
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let failures = 0;
const assert = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) failures++; };

const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations/sports_tables.sql'), 'utf8'));

const p2 = (n) => String(n).padStart(2, '0');
const d = new Date();
const DAY = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

db.prepare(`INSERT INTO sports_events (id, sport, league, home_team, away_team, start_time, status)
            VALUES ('E1','football','Liga','A','B',datetime('now','+3 hours'),'scheduled')`).run();
const insSettled = db.prepare(`
  INSERT INTO sports_bets (user_id, event_id, bet_type, selection, odds, amount, potential_winnings, status, placed_at, settled_at)
  VALUES (?, 'E1', 'moneyline', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`);
insSettled.run('U1', 'home', 2.0, 100, 200, 'lost');   // casa gana 100
insSettled.run('U2', 'away', 3.0, 200, 600, 'lost');   // casa gana 200
insSettled.run('U3', 'home', 3.5, 50, 175, 'won');     // casa paga 175 (apostó 50 -> pierde 125)
db.prepare(`INSERT INTO sports_bets (user_id,event_id,bet_type,selection,odds,amount,potential_winnings,status,placed_at)
            VALUES ('U4','E1','moneyline','away',2.2,80,176,'pending',datetime('now'))`).run();

const placed = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS staked
  FROM sports_bets WHERE date(placed_at,'localtime') = ?`).get(DAY);
const s = db.prepare(`SELECT
    SUM(CASE WHEN status='won' THEN 1 ELSE 0 END) AS won_n,
    SUM(CASE WHEN status='lost' THEN 1 ELSE 0 END) AS lost_n,
    COALESCE(SUM(CASE WHEN status='lost' THEN amount END),0) AS house_win,
    COALESCE(SUM(CASE WHEN status='won' THEN potential_winnings END),0) AS payout,
    COALESCE(SUM(CASE WHEN status='won' THEN amount END),0) AS won_stake
  FROM sports_bets WHERE status IN ('won','lost') AND date(settled_at,'localtime') = ?`).get(DAY);

const ganancias = s.house_win;
const perdidas = Math.max(0, s.payout - s.won_stake);
const neto = ganancias - perdidas;

assert(placed.n === 4 && placed.staked === 430, 'colocadas hoy: 4 apuestas, 430 monedas');
assert(s.won_n === 1 && s.lost_n === 2, 'liquidadas: 1 ganada, 2 perdidas');
assert(ganancias === 300, 'ganancias casino = 100 + 200 = 300');
assert(perdidas === 125, 'pérdidas casino = 175 − 50 = 125');
assert(neto === 175, 'neto = 300 − 125 = 175');
const euros = (c) => (c / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
assert(euros(300) === '3' && euros(175) === '1.75', 'conversión a € correcta (3 € y 1.75 €)');

console.log('\n' + (failures === 0 ? '✅ REPORTE OK' : `❌ ${failures} fallan`));
process.exit(failures === 0 ? 0 : 1);
