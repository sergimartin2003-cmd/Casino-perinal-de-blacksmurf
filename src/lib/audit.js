// Consultas de auditoría sobre las tablas bets y transfers.
const db = require('../database/db');

const userSummaryStmt = db.prepare(
  'SELECT COUNT(*) n, COALESCE(SUM(wagered),0) wagered, COALESCE(SUM(net),0) net, COALESCE(MAX(net),0) bigwin FROM bets WHERE user_id = ?'
);
const userRecentStmt = db.prepare(
  'SELECT game, wagered, net, balance_after, created_at FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT ?'
);
const sentStmt = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM transfers WHERE from_id = ?');
const recvStmt = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM transfers WHERE to_id = ?');
const topPairsStmt = db.prepare(
  'SELECT from_id, to_id, COUNT(*) veces, SUM(amount) total FROM transfers GROUP BY from_id, to_id ORDER BY total DESC LIMIT ?'
);
const topWinnersStmt = db.prepare(
  'SELECT user_id, SUM(net) ganado, COUNT(*) partidas FROM bets WHERE created_at > ? GROUP BY user_id HAVING ganado > 0 ORDER BY ganado DESC LIMIT ?'
);

/** Ficha de auditoría de un usuario: resumen de apuestas + transferencias. */
function userAudit(userId) {
  return {
    summary: userSummaryStmt.get(userId),
    recent: userRecentStmt.all(userId, 10),
    sent: sentStmt.get(userId),
    recv: recvStmt.get(userId),
  };
}

/** Pares from->to con más volumen transferido (posible granja de cuentas). */
function suspiciousTransfers(limit = 10) {
  return topPairsStmt.all(limit);
}

/** Usuarios con mayor ganancia neta desde `sinceMs`. */
function topWinners(sinceMs, limit = 10) {
  return topWinnersStmt.all(sinceMs, limit);
}

module.exports = { userAudit, suspiciousTransfers, topWinners };
