// Lotería Nova: boletos hacia un bote común y sorteo programado ponderado.
const db = require('../database/db');
const { base } = require('./embeds');
const { coins, fmt } = require('./format');
const { getUser, placeBet, payout, recordResult } = require('./economy');
const config = require('../config');

const L = () => config.lottery;

// --- Estado global (una sola fila) ---
const getStateStmt = db.prepare('SELECT * FROM lottery_state WHERE id = 1');
const initStateStmt = db.prepare('INSERT INTO lottery_state (id, round, next_draw) VALUES (1, 1, ?)');
const updStateStmt = db.prepare('UPDATE lottery_state SET round = ?, next_draw = ? WHERE id = 1');

function getState() {
  let s = getStateStmt.get();
  if (!s) {
    initStateStmt.run(Date.now() + L().drawIntervalMs);
    s = getStateStmt.get();
  }
  return s;
}
const setState = (round, nextDraw) => updStateStmt.run(round, nextDraw);

// --- Boletos ---
const ticketsForRoundStmt = db.prepare(
  'SELECT user_id, tickets FROM lottery_tickets WHERE round = ? AND tickets > 0'
);
const addTicketsStmt = db.prepare(`
  INSERT INTO lottery_tickets (round, user_id, tickets) VALUES (?, ?, ?)
  ON CONFLICT(round, user_id) DO UPDATE SET tickets = tickets + excluded.tickets
`);
const clearRoundStmt = db.prepare('DELETE FROM lottery_tickets WHERE round = ?');

function snapshot(userId) {
  const st = getState();
  const rows = ticketsForRoundStmt.all(st.round);
  const totalTickets = rows.reduce((s, r) => s + r.tickets, 0);
  const userTickets = userId ? rows.find((r) => r.user_id === userId)?.tickets ?? 0 : 0;
  const price = L().ticketPrice;
  return {
    round: st.round,
    nextDraw: st.next_draw,
    rows,
    players: rows.length,
    totalTickets,
    userTickets,
    price,
    pot: totalTickets * price,
    chance: totalTickets ? userTickets / totalTickets : 0,
  };
}

/** Compra `count` boletos. Devuelve { error } o el estado tras la compra. */
function buyTickets(userId, count) {
  if (!Number.isInteger(count) || count < 1) return { error: 'Indica un número de boletos válido.' };
  const price = L().ticketPrice;
  const cost = count * price;
  const bal = getUser(userId).balance;
  if (bal < cost) {
    return {
      error: `Necesitas ${fmt(cost)} ${config.currency.symbol} (${count} × ${fmt(price)}) y tienes ${fmt(bal)}.`,
    };
  }
  placeBet(userId, cost);
  const st = getState();
  addTicketsStmt.run(st.round, userId, count);
  return { ok: true, bought: count, cost, ...snapshot(userId) };
}

/** Elige un ganador ponderado por número de boletos. */
function pickWeighted(rows, totalTickets) {
  let pick = Math.floor(Math.random() * totalTickets);
  for (const r of rows) {
    if (pick < r.tickets) return r.user_id;
    pick -= r.tickets;
  }
  return rows[rows.length - 1].user_id; // fallback numérico
}

/**
 * Realiza el sorteo de la ronda actual y programa la siguiente.
 * @returns {{type:'empty'|'refunded'|'drawn', ...}}
 */
async function draw(client) {
  const st = getState();
  const rows = ticketsForRoundStmt.all(st.round);
  const totalTickets = rows.reduce((s, r) => s + r.tickets, 0);
  const price = L().ticketPrice;
  const pot = totalTickets * price;
  const nextDraw = Date.now() + L().drawIntervalMs;

  // Nadie compró: se mantiene la ronda, solo se reprograma.
  if (totalTickets === 0) {
    setState(st.round, nextDraw);
    return { type: 'empty', round: st.round };
  }

  // Muy pocos participantes: se reembolsa y se abre ronda nueva.
  if (rows.length < L().minParticipants) {
    for (const r of rows) {
      payout(r.user_id, r.tickets * price);
      recordResult(r.user_id, { wagered: r.tickets * price, net: 0, game: 'loteria', silent: true });
    }
    clearRoundStmt.run(st.round);
    setState(st.round + 1, nextDraw);
    const res = { type: 'refunded', round: st.round, players: rows.length, totalTickets, pot };
    await announce(client, res);
    return res;
  }

  // Sorteo ponderado.
  const winner = pickWeighted(rows, totalTickets);
  const cut = Math.floor(pot * L().houseCut);
  const prize = pot - cut;
  payout(winner, prize);
  for (const r of rows) {
    const spend = r.tickets * price;
    const net = (r.user_id === winner ? prize : 0) - spend;
    recordResult(r.user_id, { wagered: spend, net, game: 'loteria', silent: true });
  }
  clearRoundStmt.run(st.round);
  setState(st.round + 1, nextDraw);

  const res = {
    type: 'drawn',
    round: st.round,
    winner,
    winnerTickets: rows.find((r) => r.user_id === winner).tickets,
    players: rows.length,
    totalTickets,
    pot,
    cut,
    prize,
  };
  await announce(client, res);
  return res;
}

async function announce(client, res) {
  const channelId = L().channel;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    const sym = config.currency.symbol;

    let embed;
    if (res.type === 'refunded') {
      embed = base(config.colors.blurple)
        .setTitle(`🎟️ Lotería — ronda #${res.round} anulada`)
        .setDescription(`Solo hubo ${res.players} participante(s), así que el bote se **reembolsó** por completo.`);
    } else {
      embed = base(config.colors.gold)
        .setTitle(`🎉 Lotería — ganador de la ronda #${res.round}`)
        .setDescription(`🏆 <@${res.winner}> se lleva **${fmt(res.prize)}** ${sym}`)
        .addFields(
          { name: 'Bote total', value: coins(res.pot), inline: true },
          { name: 'Comisión casa', value: `${fmt(res.cut)} ${sym} (${Math.round(L().houseCut * 100)}%)`, inline: true },
          { name: 'Participantes', value: `${res.players} · ${res.totalTickets} boletos`, inline: true }
        );
    }
    await channel.send({
      content: res.type === 'drawn' ? `<@${res.winner}>` : undefined,
      embeds: [embed],
      allowedMentions: { users: res.type === 'drawn' ? [res.winner] : [] },
    });
  } catch {
    // Sin permisos o canal borrado: el premio ya está pagado, solo no anunciamos.
  }
}

/** Arranca el planificador de sorteos (llamar en ClientReady). */
function startScheduler(client) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (Date.now() >= getState().next_draw) await draw(client);
    } catch (err) {
      console.error('Error en el sorteo de lotería:', err);
    } finally {
      running = false;
    }
  };
  tick(); // por si el sorteo venció mientras el bot estaba apagado
  setInterval(tick, 30000);
}

module.exports = { buyTickets, snapshot, draw, startScheduler };
