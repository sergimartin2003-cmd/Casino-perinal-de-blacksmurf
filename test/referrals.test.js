// Sistema de referidos: bonos, anti-abuso, rake de 2 niveles e hitos.
const { gameEvents, getUser, setBalance } = require('../src/lib/economy');
const db = require('../src/database/db');
const referrals = require('../src/lib/referrals');

let f = 0; const A = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) f++; };
const bal = (id) => getUser(id).balance;

// 1) Los comandos cargan.
for (const c of ['invitar', 'referido']) {
  const m = require(`../src/commands/${c}`);
  A(m.data && typeof m.execute === 'function' && !!m.data.toJSON().name, `/${c} carga y expone {data,execute}`);
}

// Prepara usuarios nuevos (total_wagered 0).
for (const id of ['C', 'A', 'B', 'E', 'F']) setBalance(id, 1000);

// 2) Anti-abuso: no auto-invitarte.
A(referrals.link('A', 'A').error, 'bloquea auto-invitarse');

// 3) Vínculo C invita a A: A +250, C +500.
{
  const a0 = bal('A'), c0 = bal('C');
  const r = referrals.link('A', 'C');
  A(r.ok && bal('A') === a0 + 250 && bal('C') === c0 + 500, 'C invita a A: bonos correctos (+250 / +500)');
}

// 4) A invita a B.
{
  const a0 = bal('A'), b0 = bal('B');
  const r = referrals.link('B', 'A');
  A(r.ok && bal('B') === b0 + 250 && bal('A') === a0 + 500, 'A invita a B: bonos correctos');
}

// 5) No se puede vincular dos veces.
A(referrals.link('B', 'C').error, 'no permite registrar invitador dos veces');

// 6) No invitador mutuo (C no puede poner a A, a quien C ya invitó).
A(referrals.link('C', 'A').error, 'bloquea el bucle mutuo A↔C');

// 7) Solo jugadores nuevos pueden ser invitados.
setBalance('D', 1000);
db.prepare('UPDATE users SET total_wagered = ? WHERE id = ?').run(60000, 'D');
A(referrals.link('D', 'C').error, 'rechaza invitar a un jugador ya veterano');

// 8) Rake de 2 niveles: B juega -> A (nivel 1, 5%) y C (nivel 2, 2%).
{
  const a0 = bal('A'), c0 = bal('C');
  gameEvents.emit('result', { userId: 'B', game: 'slots', wagered: 1000, net: -100, balance: bal('B') });
  A(bal('A') === a0 + 50, 'rake nivel 1: A gana 5% de 1000 = 50');
  A(bal('C') === c0 + 20, 'rake nivel 2: C gana 2% de 1000 = 20');
}

// 9) Hitos: A llega a 3 invitados -> reclama +2000, idempotente.
referrals.link('E', 'A');
referrals.link('F', 'A');
A(referrals.invitedCount('A') === 3, 'A tiene 3 invitados directos');
{
  const a0 = bal('A');
  const r1 = referrals.claimMilestones('A');
  A(r1.got === 2000 && bal('A') === a0 + 2000, 'hito de 3 invitados paga +2000');
  const r2 = referrals.claimMilestones('A');
  A(r2.got === 0, 'reclamar el hito otra vez no vuelve a pagar (idempotente)');
}

console.log('\n' + (f === 0 ? '✅ REFERIDOS OK' : `❌ ${f} fallan`));
process.exit(f === 0 ? 0 : 1);
