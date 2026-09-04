// Features de retención: rangos VIP, ranking del día y misiones diarias.
// Valida que los comandos cargan (data válida + statements compilan) y la lógica.
const db = require('../src/database/db');
const { tierOf } = require('../src/lib/vip');
const { dayKey } = require('../src/lib/dailyReport');

let f = 0; const A = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) f++; };

// 1) Los comandos cargan y su definición es válida (lo que usa deploy-commands).
const cmds = ['vip', 'rankdia', 'misiones'];
for (const c of cmds) {
  const m = require(`../src/commands/${c}`);
  A(m.data && typeof m.execute === 'function' && !!m.data.toJSON().name, `/${c} carga y expone {data,execute}`);
}

// 2) Rangos VIP por volumen apostado.
A(tierOf(0).tier.key === 'bronce', 'wagered 0 -> Bronce');
A(tierOf(49999).tier.key === 'bronce', '49.999 -> Bronce');
A(tierOf(50000).tier.key === 'plata', '50.000 -> Plata');
A(tierOf(300000).tier.key === 'oro', '300k -> Oro');
A(tierOf(9000000).tier.key === 'diamante' && tierOf(9000000).next === null, '9M -> Diamante (rango máximo)');

// 3) Ranking del día (misma query que /rankdia) sobre la tabla `bets`.
const now = Date.now();
db.prepare('INSERT OR REPLACE INTO users (id, balance, total_wagered, created_at) VALUES (?,?,?,?)').run('W1', 1000, 300000, now);
db.prepare('INSERT OR REPLACE INTO users (id, balance, total_wagered, created_at) VALUES (?,?,?,?)').run('W2', 1000, 10000, now);
const insBet = db.prepare('INSERT INTO bets (user_id,game,wagered,net,balance_after,created_at) VALUES (?,?,?,?,?,?)');
insBet.run('W1', 'slots', 100, 50, 1050, now);
insBet.run('W1', 'ruleta', 100, 30, 1080, now);
insBet.run('W2', 'dados', 200, -200, 800, now);
const startOfDay = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
const rows = db.prepare(`SELECT user_id, SUM(net) net, COUNT(*) plays FROM bets WHERE created_at >= ? GROUP BY user_id ORDER BY net DESC`).all(startOfDay);
A(rows[0].user_id === 'W1' && rows[0].net === 80 && rows[0].plays === 2, 'top del día = W1 con +80 en 2 jugadas');
A(rows[1].user_id === 'W2' && rows[1].net === -200, 'segundo = W2 con -200');

// 4) Misiones: reclamar es idempotente (no paga dos veces la misma misión/día).
const day = dayKey();
db.prepare('INSERT OR REPLACE INTO daily_active (day,user_id,wagered,bets) VALUES (?,?,?,?)').run(day, 'M1', 6000, 12);
const a = db.prepare('SELECT bets, wagered FROM daily_active WHERE day=? AND user_id=?').get(day, 'M1');
A(a.bets >= 10 && a.wagered >= 5000, 'M1 cumple "10 apuestas" y "volumen 5000" hoy');
const insClaim = db.prepare('INSERT OR IGNORE INTO mission_claims (day,user_id,mission,claimed_at) VALUES (?,?,?,?)');
const r1 = insClaim.run(day, 'M1', 'jugar10', Date.now());
const r2 = insClaim.run(day, 'M1', 'jugar10', Date.now());
A(r1.changes === 1 && r2.changes === 0, 'reclamar la misma misión dos veces no vuelve a pagar (idempotente)');

console.log('\n' + (f === 0 ? '✅ ENGAGEMENT OK' : `❌ ${f} fallan`));
process.exit(f === 0 ? 0 : 1);
