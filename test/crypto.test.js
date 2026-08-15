// Resolución de /cripto: reembolso atómico y SIN doble pago al re-ejecutar
// (la apuesta queda marcada resuelta). CoinGecko no es accesible en tests, así
// que la apuesta se siembra pasada del margen de reembolso -> se reembolsa.
const db = require('../src/database/db');
const { setBalance, getUser } = require('../src/lib/economy');
const crypto = require('../src/lib/cryptoRounds');

let f = 0; const A = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) f++; };
const mockClient = { channels: { fetch: async () => { throw new Error('sin canal'); } } };

(async () => {
  const uid = 'CR_x';
  setBalance(uid, 500);
  const closeAt = Date.now() - 31 * 60 * 1000; // vencida hace >30 min (supera REFUND_GRACE_MS)
  const id = db.prepare(`INSERT INTO crypto_pending
    (user_id, channel_id, message_id, coin, dir, wager, open_price, open_at, close_at, resolved)
    VALUES (?, '0', NULL, 'btc', 'up', 100, 100, ?, ?, 0)`).run(uid, closeAt - 3600000, closeAt).lastInsertRowid;

  await crypto.resolveDue(mockClient);
  A(getUser(uid).balance === 600, 'reembolsa la apuesta (+100 -> 600)');
  A(db.prepare('SELECT resolved FROM crypto_pending WHERE id = ?').get(id).resolved === 1, 'la apuesta queda marcada como resuelta');

  await crypto.resolveDue(mockClient); // segunda pasada
  A(getUser(uid).balance === 600, 'no paga dos veces al re-ejecutar (sin doble pago)');

  console.log('\n' + (f === 0 ? '✅ CRIPTO OK' : `❌ ${f} fallan`));
  process.exit(f === 0 ? 0 : 1);
})().catch((e) => { console.error('ERROR TEST:', e); process.exit(1); });
