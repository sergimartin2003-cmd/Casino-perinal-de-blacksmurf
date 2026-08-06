// Casa de apuestas gestionada por owners: mercados de cuotas fijas.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const db = require('../database/db');
const { base } = require('./embeds');
const { coins, fmt } = require('./format');
const { getUser, placeBet, payout, recordResult } = require('./economy');
const espn = require('./espn');
const config = require('../config');

// --- Sentencias ---
const insertMarketStmt = db.prepare(`
  INSERT INTO markets (title, options, channel_id, league, event_id, event_date, created_by, created_at)
  VALUES (@title, @options, @channel_id, @league, @event_id, @event_date, @created_by, @created_at)
`);
const pendingMatchStmt = db.prepare("SELECT * FROM markets WHERE status IN ('open','closed') AND event_id IS NOT NULL");
const getMarketStmt = db.prepare('SELECT * FROM markets WHERE id = ?');
const listOpenStmt = db.prepare("SELECT * FROM markets WHERE status IN ('open','closed') ORDER BY id DESC LIMIT 20");
const setStatusStmt = db.prepare('UPDATE markets SET status = ? WHERE id = ?');
const setMessageStmt = db.prepare('UPDATE markets SET message_id = ? WHERE id = ?');
const resolveStmt = db.prepare("UPDATE markets SET status = 'resolved', winner = ?, resolved_at = ? WHERE id = ?");
const voidStmt = db.prepare("UPDATE markets SET status = 'void', resolved_at = ? WHERE id = ?");

const insertBetStmt = db.prepare(`
  INSERT INTO market_bets (market_id, user_id, option_idx, stake, odds, created_at)
  VALUES (@market_id, @user_id, @option_idx, @stake, @odds, @created_at)
`);
const betsForMarketStmt = db.prepare('SELECT * FROM market_bets WHERE market_id = ?');
const userBetsStmt = db.prepare('SELECT option_idx, SUM(stake) stake FROM market_bets WHERE market_id = ? AND user_id = ? GROUP BY option_idx');

function optionsOf(market) {
  return JSON.parse(market.options);
}

/** Parsea "Madrid 2.1, Empate 3.3, Barça 3.4" -> [{name, odds}]. */
function parseOptions(str) {
  const parts = String(str).split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { error: 'Pon al menos 2 opciones separadas por comas.' };
  if (parts.length > 12) return { error: 'Máximo 12 opciones.' };
  const options = [];
  for (const p of parts) {
    const m = p.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)$/);
    if (!m) return { error: `Opción inválida: "${p}". Usa "Nombre Cuota", p. ej. "Madrid 2.1".` };
    const name = m[1].trim();
    const odds = parseFloat(m[2].replace(',', '.'));
    if (!(odds >= 1.01) || odds > 1000) return { error: `Cuota inválida en "${p}" (debe estar entre 1.01 y 1000).` };
    options.push({ name, odds });
  }
  return { options };
}

function createMarket({ title, options, channelId, userId, league = null, eventId = null, eventDate = null }) {
  const info = insertMarketStmt.run({
    title,
    options: JSON.stringify(options),
    channel_id: channelId,
    league,
    event_id: eventId,
    event_date: eventDate,
    created_by: userId,
    created_at: Date.now(),
  });
  return info.lastInsertRowid;
}

/** Crea un mercado enlazado a un evento real de ESPN (1X2 o a 2 opciones). */
function createMatchMarket({ leagueKey, eventId, eventDate, homeName, awayName, odds, channelId, userId }) {
  const options = espn.hasDraw(leagueKey)
    ? [
        { name: homeName, odds: odds[0] },
        { name: 'Empate', odds: odds[1] },
        { name: awayName, odds: odds[2] },
      ]
    : [
        { name: homeName, odds: odds[0] },
        { name: awayName, odds: odds[1] },
      ];
  return createMarket({ title: `${homeName} vs ${awayName}`, options, channelId, userId, league: leagueKey, eventId, eventDate });
}

const getMarket = (id) => getMarketStmt.get(id);
const listOpen = () => listOpenStmt.all();

/** Coloca una apuesta. Devuelve { error } o { ok, ... }. */
function placeMarketBet(marketId, userId, optionIdx, stake) {
  const market = getMarket(marketId);
  if (!market) return { error: `No existe el mercado #${marketId}.` };
  if (market.status !== 'open') return { error: `El mercado #${marketId} ya no admite apuestas (${market.status}).` };
  const options = optionsOf(market);
  if (optionIdx < 0 || optionIdx >= options.length) return { error: 'Esa opción no existe en este mercado.' };
  const bal = getUser(userId).balance;
  if (bal < stake) return { error: `Necesitas ${fmt(stake)} ${config.currency.symbol} y tienes ${fmt(bal)}.` };

  placeBet(userId, stake);
  insertBetStmt.run({
    market_id: marketId,
    user_id: userId,
    option_idx: optionIdx,
    stake,
    odds: options[optionIdx].odds,
    created_at: Date.now(),
  });
  return { ok: true, market, option: options[optionIdx], potential: Math.round(stake * options[optionIdx].odds) };
}

/** Resumen de dinero apostado por opción. */
function poolByOption(marketId, optionsLen) {
  const pools = new Array(optionsLen).fill(0);
  let total = 0;
  for (const b of betsForMarketStmt.all(marketId)) {
    pools[b.option_idx] = (pools[b.option_idx] || 0) + b.stake;
    total += b.stake;
  }
  return { pools, total };
}

const userStakes = (marketId, userId) => userBetsStmt.all(marketId, userId);

function closeMarket(id) {
  const m = getMarket(id);
  if (!m) return { error: `No existe el mercado #${id}.` };
  if (m.status !== 'open') return { error: `El mercado #${id} no está abierto (${m.status}).` };
  setStatusStmt.run('closed', id);
  return { ok: true };
}

/** Resuelve el mercado con la opción ganadora (índice) y paga a los acertantes. */
async function resolveMarket(client, id, winnerIdx) {
  const market = getMarket(id);
  if (!market) return { error: `No existe el mercado #${id}.` };
  if (market.status === 'resolved' || market.status === 'void') return { error: `El mercado #${id} ya está cerrado (${market.status}).` };
  const options = optionsOf(market);
  if (winnerIdx < 0 || winnerIdx >= options.length) return { error: 'Esa opción ganadora no existe.' };

  const bets = betsForMarketStmt.all(id);
  let totalStaked = 0;
  let totalPaid = 0;
  let winners = 0;
  for (const b of bets) {
    totalStaked += b.stake;
    const won = b.option_idx === winnerIdx;
    const returned = won ? Math.round(b.stake * b.odds) : 0;
    if (won) {
      payout(b.user_id, returned);
      totalPaid += returned;
      winners++;
    }
    recordResult(b.user_id, { wagered: b.stake, net: returned - b.stake, game: 'apuestas', silent: true });
  }
  resolveStmt.run(winnerIdx, Date.now(), id);

  const res = { type: 'resolved', market, winnerName: options[winnerIdx].name, winnerOdds: options[winnerIdx].odds, totalStaked, totalPaid, winners, bets: bets.length };
  await announce(client, res);
  await updateBoard(client, getMarket(id));
  return { ok: true, ...res };
}

/** Anula el mercado y reembolsa todas las apuestas. */
async function voidMarket(client, id) {
  const market = getMarket(id);
  if (!market) return { error: `No existe el mercado #${id}.` };
  if (market.status === 'resolved' || market.status === 'void') return { error: `El mercado #${id} ya está cerrado (${market.status}).` };
  const bets = betsForMarketStmt.all(id);
  let refunded = 0;
  for (const b of bets) {
    payout(b.user_id, b.stake);
    recordResult(b.user_id, { wagered: b.stake, net: 0, game: 'apuestas', silent: true });
    refunded += b.stake;
  }
  voidStmt.run(Date.now(), id);
  const res = { type: 'void', market, refunded, bets: bets.length };
  await announce(client, res);
  await updateBoard(client, getMarket(id));
  return { ok: true, ...res };
}

async function announce(client, res) {
  const channelId = res.market.channel_id;
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    const sym = config.currency.symbol;
    let embed;
    if (res.type === 'void') {
      embed = base(config.colors.blurple)
        .setTitle(`🚫 Mercado #${res.market.id} anulado`)
        .setDescription(`**${res.market.title}**\nSe reembolsaron ${res.bets} apuesta(s): ${coins(res.refunded)}.`);
    } else {
      embed = base(config.colors.gold)
        .setTitle(`🏁 Mercado #${res.market.id} resuelto`)
        .setDescription(`**${res.market.title}**\n✅ Resultado: **${res.winnerName}** (cuota ${res.winnerOdds})`)
        .addFields(
          { name: 'Apostado', value: coins(res.totalStaked), inline: true },
          { name: 'Ganadores', value: `${res.winners} de ${res.bets}`, inline: true },
          { name: 'Pagado', value: coins(res.totalPaid), inline: true }
        );
    }
    await channel.send({ embeds: [embed] });
  } catch {
    // Sin permisos o canal borrado: los pagos ya están hechos, solo no anunciamos.
  }
}

const setMessage = (id, messageId) => setMessageStmt.run(messageId, id);

const STATUS_LABEL = { open: '🟢 Abiertas', closed: '🔒 Cerradas', resolved: '🏁 Resuelto', void: '🚫 Anulado' };

/** Embed-tablero (público) de un mercado. */
function boardEmbed(market) {
  const options = optionsOf(market);
  const { pools, total } = poolByOption(market.id, options.length);
  const lines = options.map((o, i) => {
    const pool = pools[i] || 0;
    const pct = total ? Math.round((pool / total) * 100) : 0;
    const win = market.status === 'resolved' && market.winner === i ? ' ✅' : '';
    return `**${i + 1}.** ${o.name} — cuota **${o.odds}** · ${fmt(pool)} ${config.currency.symbol} (${pct}%)${win}`;
  });
  return base(market.status === 'resolved' ? config.colors.gold : config.colors.primary)
    .setTitle(`🎯 Mercado #${market.id} · ${market.title}`)
    .setDescription(lines.join('\n'))
    .addFields(
      { name: 'Apuestas', value: STATUS_LABEL[market.status] || market.status, inline: true },
      { name: 'Bote total', value: coins(total), inline: true }
    )
    .setFooter({ text: `${config.casino.name} • pulsa una opción para apostar` });
}

/** Botones (uno por opción). Deshabilitados si el mercado no está abierto. */
function boardComponents(market) {
  const options = optionsOf(market);
  const open = market.status === 'open';
  const rows = [];
  for (let i = 0; i < options.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const o of options.slice(i, i + 5)) {
      const idx = options.indexOf(o);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`bet:${market.id}:${idx}`)
          .setLabel(`${o.name} @${o.odds}`.slice(0, 80))
          .setStyle(market.status === 'resolved' && market.winner === idx ? ButtonStyle.Success : ButtonStyle.Primary)
          .setDisabled(!open)
      );
    }
    rows.push(row);
  }
  return rows;
}

const renderBoard = (market) => ({ embeds: [boardEmbed(market)], components: boardComponents(market) });

/** Publica el mensaje-tablero de un mercado en su canal y guarda su id.
 *  Devuelve { ok:true, msg } o { ok:false, error } con el motivo real. */
async function publishBoard(client, market) {
  const channel = await client.channels.fetch(market.channel_id).catch((e) => ({ __err: e.message }));
  if (!channel || channel.__err) return { ok: false, error: `no encuentro el canal (${channel?.__err || 'no existe'})` };
  if (!channel.isTextBased()) return { ok: false, error: 'ese canal no es de texto' };
  try {
    const msg = await channel.send(renderBoard(market));
    setMessage(market.id, msg.id);
    return { ok: true, msg };
  } catch (e) {
    console.error('publishBoard error:', e);
    return { ok: false, error: e.message };
  }
}

/** Reedita el mensaje-tablero para reflejar el estado actual (best-effort). */
async function updateBoard(client, market) {
  if (!market.channel_id || !market.message_id) return;
  try {
    const channel = await client.channels.fetch(market.channel_id);
    if (!channel || !channel.isTextBased()) return;
    const msg = await channel.messages.fetch(market.message_id);
    await msg.edit(renderBoard(market));
  } catch {
    /* mensaje borrado o sin permisos */
  }
}

/** Revisa los mercados-partido: cierra al empezar, resuelve al terminar, anula si se suspende. */
async function resolveMatchMarkets(client) {
  for (const m of pendingMatchStmt.all()) {
    // No consultar antes de la hora del evento (con 5 min de margen).
    if (m.event_date && Date.now() < m.event_date - 5 * 60 * 1000) continue;
    const r = await espn.fetchEventResult(m.league, m.event_id, m.event_date);
    if (!r.ok) continue;
    if (r.canceled || r.voidResult) {
      await voidMarket(client, m.id); // suspendido o sin ganador → reembolso
    } else if (r.completed && r.winnerIdx != null) {
      await resolveMarket(client, m.id, r.winnerIdx);
    } else if (r.state === 'in' && m.status === 'open') {
      closeMarket(m.id); // el evento ha empezado: se cierran las apuestas
      await updateBoard(client, getMarket(m.id));
    }
  }
}

/** Arranca el vigilante de partidos reales (llamar en ClientReady). */
function startMatchResolver(client) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await resolveMatchMarkets(client);
    } catch (err) {
      console.error('Error resolviendo mercados-partido:', err);
    } finally {
      running = false;
    }
  };
  tick();
  setInterval(tick, 3 * 60 * 1000);
}

module.exports = {
  parseOptions,
  createMarket,
  createMatchMarket,
  getMarket,
  listOpen,
  optionsOf,
  placeMarketBet,
  poolByOption,
  userStakes,
  closeMarket,
  resolveMarket,
  voidMarket,
  setMessage,
  boardEmbed,
  boardComponents,
  renderBoard,
  publishBoard,
  updateBoard,
  resolveMatchMarkets,
  startMatchResolver,
};
