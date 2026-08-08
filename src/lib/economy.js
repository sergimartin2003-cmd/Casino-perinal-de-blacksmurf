const { EventEmitter } = require('node:events');
const db = require('../database/db');
const config = require('../config');

// Emite un evento por cada partida liquidada (lo escucha el log de partidas).
const gameEvents = new EventEmitter();

const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUserStmt = db.prepare(
  'INSERT INTO users (id, balance, created_at) VALUES (?, ?, ?)'
);

/** Devuelve el usuario, creándolo con saldo inicial si no existe. */
function getUser(id) {
  let user = getUserStmt.get(id);
  if (!user) {
    insertUserStmt.run(id, config.economy.startingBalance, Date.now());
    user = getUserStmt.get(id);
  }
  return user;
}

const setBalanceStmt = db.prepare('UPDATE users SET balance = ? WHERE id = ?');

function setBalance(id, amount) {
  getUser(id);
  const val = Math.max(0, Math.round(amount));
  setBalanceStmt.run(val, id);
  return val;
}

function addBalance(id, amount) {
  const user = getUser(id);
  return setBalance(id, user.balance + Math.round(amount));
}

/** Retira la apuesta del saldo. Devuelve false si no hay fondos. */
function placeBet(id, amount) {
  const user = getUser(id);
  if (user.balance < amount) return false;
  setBalance(id, user.balance - amount);
  return true;
}

/** Acredita ganancias (cantidad total a devolver, incluida la apuesta). */
function payout(id, amount) {
  if (amount <= 0) return;
  addBalance(id, amount);
}

const recordStmt = db.prepare(`
  UPDATE users SET
    total_wagered = total_wagered + @wagered,
    total_won     = total_won + @won,
    total_lost    = total_lost + @lost,
    games_played  = games_played + 1,
    biggest_win   = MAX(biggest_win, @bigwin)
  WHERE id = @id
`);

/**
 * Registra el resultado de una partida en las estadísticas.
 * @param {string} id
 * @param {{ wagered: number, net: number }} r  net > 0 ganancia, net < 0 pérdida
 */
function recordResult(id, { wagered, net, game, silent }) {
  getUser(id);
  recordStmt.run({
    id,
    wagered: Math.round(wagered),
    won: net > 0 ? Math.round(net) : 0,
    lost: net < 0 ? Math.round(-net) : 0,
    bigwin: net > 0 ? Math.round(net) : 0,
  });
  if (silent) return; // p. ej. la lotería registra stats pero anuncia aparte
  gameEvents.emit('result', {
    userId: id,
    game: game ?? null,
    wagered: Math.round(wagered),
    net: Math.round(net),
    balance: getUser(id).balance,
  });
}

const topStmt = db.prepare(
  'SELECT id, balance, bank FROM users ORDER BY (balance + bank) DESC LIMIT ?'
);
function topUsers(limit = 10) {
  return topStmt.all(limit);
}

const setDailyStmt = db.prepare(
  'UPDATE users SET last_daily = ?, daily_streak = ? WHERE id = ?'
);
const setWorkStmt = db.prepare('UPDATE users SET last_work = ? WHERE id = ?');

// --- Jackpot progresivo (tragaperras) ---
// Bote común compartido por todo el servidor: crece con las tiradas de la gente
// (un % de cada apuesta) y se reinicia a la semilla cuando alguien lo revienta.
const JACKPOT_KEY = 'slots_jackpot';
const JACKPOT_SEED = config.jackpot.seed;
const getMetaStmt = db.prepare('SELECT value FROM meta WHERE key = ?');
const setMetaStmt = db.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getJackpot() {
  const row = getMetaStmt.get(JACKPOT_KEY);
  if (!row) {
    setMetaStmt.run(JACKPOT_KEY, JACKPOT_SEED);
    return JACKPOT_SEED;
  }
  return row.value;
}

function addJackpot(amount) {
  const val = getJackpot() + Math.round(amount);
  setMetaStmt.run(JACKPOT_KEY, val);
  return val;
}

function resetJackpot() {
  setMetaStmt.run(JACKPOT_KEY, JACKPOT_SEED);
  return JACKPOT_SEED;
}

const insertJackpotWinStmt = db.prepare(
  'INSERT INTO jackpot_wins (user_id, amount, won_at) VALUES (?, ?, ?)'
);
const lastJackpotWinStmt = db.prepare(
  'SELECT user_id, amount, won_at FROM jackpot_wins ORDER BY id DESC LIMIT 1'
);
const jackpotWinsCountStmt = db.prepare('SELECT COUNT(*) AS n FROM jackpot_wins');

/** Guarda en el historial que un usuario reventó el bote. */
function recordJackpotWin(userId, amount) {
  insertJackpotWinStmt.run(userId, Math.round(amount), Date.now());
}

/** Último jackpot ganado: { user_id, amount, won_at } o undefined si nunca. */
function getLastJackpotWin() {
  return lastJackpotWinStmt.get();
}

/** Nº de veces que se ha reventado el bote en total. */
function getJackpotWinsCount() {
  return jackpotWinsCountStmt.get().n;
}

// --- Invitaciones (para el gate anti cuentas falsas del jackpot) ---
const addInviteStmt = db.prepare(
  'INSERT INTO invites (user_id, count) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET count = count + 1'
);
const getInviteCountStmt = db.prepare('SELECT count FROM invites WHERE user_id = ?');

/** Suma una invitación acreditada a un usuario. */
function addInvite(userId) {
  addInviteStmt.run(userId);
}

/** Invitaciones acreditadas a un usuario (0 si ninguna). */
function getInviteCount(userId) {
  return getInviteCountStmt.get(userId)?.count ?? 0;
}

module.exports = {
  getUser,
  setBalance,
  addBalance,
  placeBet,
  payout,
  recordResult,
  topUsers,
  setDaily: (id, ts, streak) => setDailyStmt.run(ts, streak, id),
  setWork: (id, ts) => setWorkStmt.run(ts, id),
  getJackpot,
  addJackpot,
  resetJackpot,
  recordJackpotWin,
  getLastJackpotWin,
  getJackpotWinsCount,
  addInvite,
  getInviteCount,
  gameEvents,
};
