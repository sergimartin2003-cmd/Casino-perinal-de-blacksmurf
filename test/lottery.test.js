// Sorteo de lotería: paga UNA vez al ganador, limpia la ronda y avanza el estado
// (para que un reinicio no vuelva a sortear la misma ronda). BD temporal (runner).
const db = require('../src/database/db');
const { setBalance, getUser } = require('../src/lib/economy');
const lottery = require('../src/lib/lottery');
const cfg = require('../src/config').lottery;

let f = 0; const A = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) f++; };

(async () => {
  const ROUND = 900000 + Math.floor(Math.random() * 1000);
  const users = ['LT_a', 'LT_b', 'LT_c'];
  db.prepare('INSERT OR REPLACE INTO lottery_state (id, round, next_draw) VALUES (1, ?, ?)').run(ROUND, Date.now() - 1000);
  for (const u of users) setBalance(u, 1000);
  db.prepare('DELETE FROM lottery_tickets WHERE round = ?').run(ROUND);
  for (const u of users) db.prepare('INSERT INTO lottery_tickets (round,user_id,tickets) VALUES (?,?,1)').run(ROUND, u);

  const pot = 3 * cfg.ticketPrice;
  const prize = pot - Math.floor(pot * cfg.houseCut);

  const res = await lottery.draw(null); // channel '' -> announce no usa client
  A(res.type === 'drawn', 'se sortea (3 participantes ≥ mínimo)');
  A(res.prize === prize, `premio correcto (${prize})`);

  const deltas = users.map((u) => ({ u, d: getUser(u).balance - 1000 }));
  const winners = deltas.filter((x) => x.d === prize);
  A(winners.length === 1, 'exactamente un ganador cobró el premio');
  A(deltas.filter((x) => x.d !== prize).every((x) => x.d === 0), 'los no ganadores no cobran nada');
  A(winners[0].u === res.winner, 'el ganador coincide con el reportado');

  A(db.prepare('SELECT COUNT(*) n FROM lottery_tickets WHERE round = ?').get(ROUND).n === 0, 'boletos de la ronda eliminados');
  const st = db.prepare('SELECT round, next_draw FROM lottery_state WHERE id = 1').get();
  A(st.round === ROUND + 1, 'ronda avanzada (+1)');
  A(st.next_draw > Date.now(), 'próximo sorteo en el futuro (un reinicio no re-sortea)');

  console.log('\n' + (f === 0 ? '✅ LOTERÍA OK' : `❌ ${f} fallan`));
  process.exit(f === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR TEST:', e); process.exit(1); });
