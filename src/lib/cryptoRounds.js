// Lógica compartida de /cripto: precios reales, apuestas pendientes y su
// resolución en diferido (para ventanas de tiempo de hasta 1 h).
const db = require('../database/db');
const { base } = require('./embeds');
const { coins, fmt } = require('./format');
const { payout, recordResult, getUser } = require('./economy');
const config = require('../config');

// Pago por acierto (beneficio). ~50/50 con ligera ventaja de la casa.
const WIN_MULT = 0.95;

// Si al cerrar CoinGecko no responde, esperamos hasta este margen antes de
// reembolsar la apuesta (para no liquidar con un precio inventado).
const REFUND_GRACE_MS = 30 * 60 * 1000;

const COINS = {
  btc: { id: 'bitcoin', name: 'Bitcoin', emoji: '₿', fallback: 65000 },
  eth: { id: 'ethereum', name: 'Ethereum', emoji: 'Ξ', fallback: 3400 },
  sol: { id: 'solana', name: 'Solana', emoji: '◎', fallback: 150 },
  bnb: { id: 'binancecoin', name: 'BNB', emoji: '🟡', fallback: 580 },
  doge: { id: 'dogecoin', name: 'Dogecoin', emoji: '🐕', fallback: 0.15 },
};

async function fetchPrice(coin) {
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coin.id}&vs_currencies=usd&include_24hr_change=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    const d = data[coin.id];
    if (!d || typeof d.usd !== 'number') throw new Error('no data');
    return { price: d.usd, change24h: d.usd_24h_change ?? 0, live: true };
  } catch {
    return { price: coin.fallback, change24h: 0, live: false };
  }
}

function fmtPrice(p) {
  if (p >= 100) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  if (p >= 1) return `$${p.toFixed(3)}`;
  return `$${p.toFixed(5)}`;
}

// --- Sentencias de la tabla de apuestas pendientes ---
const insertStmt = db.prepare(`
  INSERT INTO crypto_pending
    (user_id, channel_id, message_id, coin, dir, wager, open_price, open_at, close_at)
  VALUES
    (@user_id, @channel_id, @message_id, @coin, @dir, @wager, @open_price, @open_at, @close_at)
`);
const dueStmt = db.prepare('SELECT * FROM crypto_pending WHERE resolved = 0 AND close_at <= ? ORDER BY close_at ASC');
const markStmt = db.prepare('UPDATE crypto_pending SET resolved = 1 WHERE id = ?');

function addPending(row) {
  return insertStmt.run(row).lastInsertRowid;
}

function resultEmbed(bet, openP, closeP, outcome, net) {
  const coin = COINS[bet.coin];
  const dirLabel = bet.dir === 'up' ? '📈 SUBE' : '📉 BAJA';
  const pct = openP ? (closeP - openP) / openP : 0;
  const arrow = closeP > openP ? '🟢▲' : closeP < openP ? '🔴▼' : '⚪▬';
  const bal = getUser(bet.user_id).balance;

  let color;
  let line;
  if (outcome === 'refund') {
    color = config.colors.blurple;
    line = '↩️ No se pudo obtener el precio de cierre. Apuesta **reembolsada**.';
  } else if (outcome === 'flat') {
    color = config.colors.blurple;
    line = '🤝 El precio no se movió. Recuperas tu apuesta.';
  } else if (outcome === 'win') {
    color = config.colors.green;
    line = `🎉 **¡Acertaste!** +${fmt(net)} ${config.currency.symbol}`;
  } else {
    color = config.colors.red;
    line = `💀 **Fallaste.** ${fmt(net)} ${config.currency.symbol}`;
  }

  return base(color)
    .setTitle(`${coin.emoji} ${coin.name} — resultado ${arrow}`)
    .addFields(
      { name: 'Apertura', value: fmtPrice(openP), inline: true },
      { name: 'Cierre', value: fmtPrice(closeP), inline: true },
      { name: 'Variación', value: `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(3)}%`, inline: true },
      { name: 'Tu predicción', value: dirLabel, inline: true },
      { name: 'Resultado', value: line, inline: false },
      { name: 'Saldo', value: coins(bal), inline: true }
    )
    .setFooter({ text: `${config.casino.name} • precio real de CoinGecko` });
}

async function announce(client, bet, embed) {
  try {
    const channel = await client.channels.fetch(bet.channel_id);
    if (!channel || !channel.isTextBased()) return;
    await channel.send({
      content: `<@${bet.user_id}>`,
      embeds: [embed],
      allowedMentions: { users: [bet.user_id] },
      ...(bet.message_id ? { reply: { messageReference: bet.message_id, failIfNotExists: false } } : {}),
    });
  } catch {
    // Sin permisos o canal borrado: el saldo ya está acreditado, solo no avisamos.
  }
}

/** Liquida todas las apuestas cuya ventana ya cerró. */
async function resolveDue(client) {
  const now = Date.now();
  const due = dueStmt.all(now);
  if (!due.length) return;

  const priceCache = new Map();
  for (const bet of due) {
    const coin = COINS[bet.coin];
    if (!coin) {
      markStmt.run(bet.id); // moneda desconocida: no dejarla colgada
      continue;
    }

    let quote = priceCache.get(bet.coin);
    if (!quote) {
      quote = await fetchPrice(coin);
      priceCache.set(bet.coin, quote);
    }

    // Sin precio real: reintentar más tarde, salvo que lleve demasiado colgada.
    if (!quote.live) {
      if (now > bet.close_at + REFUND_GRACE_MS) {
        // Reembolso + marcar resuelta, atómico: si el bot se reinicia a medias no
        // se paga dos veces (la apuesta queda resuelta o intacta, nunca a medias).
        db.transaction(() => {
          payout(bet.user_id, bet.wager);
          recordResult(bet.user_id, { wagered: bet.wager, net: 0, game: 'cripto' });
          markStmt.run(bet.id);
        })();
        await announce(client, bet, resultEmbed(bet, bet.open_price, bet.open_price, 'refund', 0));
      }
      continue;
    }

    const openP = bet.open_price;
    const closeP = quote.price;
    let outcome;
    let net;
    let returned;
    if (closeP === openP) {
      outcome = 'flat';
      net = 0;
      returned = bet.wager;
    } else {
      const wentUp = closeP > openP;
      const win = (bet.dir === 'up' && wentUp) || (bet.dir === 'down' && !wentUp);
      outcome = win ? 'win' : 'lose';
      net = win ? Math.round(bet.wager * WIN_MULT) : -bet.wager;
      returned = win ? bet.wager + net : 0;
    }

    // Pago + marcar resuelta, atómico: un reinicio a medias no paga dos veces.
    db.transaction(() => {
      payout(bet.user_id, returned);
      recordResult(bet.user_id, { wagered: bet.wager, net, game: 'cripto' });
      markStmt.run(bet.id);
    })();
    await announce(client, bet, resultEmbed(bet, openP, closeP, outcome, net));
  }
}

/** Arranca el bucle que resuelve apuestas pendientes (llamar en ClientReady). */
function startResolver(client) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await resolveDue(client);
    } catch (err) {
      console.error('Error resolviendo apuestas de /cripto:', err);
    } finally {
      running = false;
    }
  };
  tick(); // limpia las que vencieron mientras el bot estaba apagado
  setInterval(tick, 20000);
}

module.exports = { WIN_MULT, COINS, fetchPrice, fmtPrice, addPending, resolveDue, startResolver };
