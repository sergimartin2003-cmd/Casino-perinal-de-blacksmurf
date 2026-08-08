// Anti-fraude: límites por usuario en una ventana móvil de 1 hora.
//  - Máx. de apuestas por hora.
//  - Máx. de monedas ganadas por hora (previene explotación de bugs/rachas).
//  - Cuentas de Discord nuevas (< X h) con apuesta limitada.
// Los owners y administradores están EXENTOS de todo.
//
// El recuento se lleva en memoria (se reinicia si se reinicia el bot). Las
// apuestas y ganancias se registran escuchando los resultados de las partidas,
// igual que el log y el reporte diario.
const { PermissionFlagsBits } = require('discord.js');
const { gameEvents } = require('./economy');
const { isOwner } = require('./owner');
const { fmt } = require('./format');
const config = require('../config');

const HOUR = 60 * 60 * 1000;
const AF = () => config.antifraud;

const betLog = new Map(); // user_id -> number[] (timestamps de apuestas)
const winLog = new Map(); // user_id -> { ts, amount }[] (ganancias)

/** Timestamps de apuestas de la última hora (poda las viejas). */
function recentBets(userId) {
  const cutoff = Date.now() - HOUR;
  const arr = (betLog.get(userId) || []).filter((ts) => ts >= cutoff);
  betLog.set(userId, arr);
  return arr;
}

/** Ganancias (suma) de la última hora (poda las viejas). */
function wonLastHour(userId) {
  const cutoff = Date.now() - HOUR;
  const arr = (winLog.get(userId) || []).filter((w) => w.ts >= cutoff);
  winLog.set(userId, arr);
  return arr.reduce((s, w) => s + w.amount, 0);
}

function recordBet(userId) {
  recentBets(userId).push(Date.now());
}

function recordWin(userId, amount) {
  if (amount <= 0) return;
  const cutoff = Date.now() - HOUR;
  const arr = (winLog.get(userId) || []).filter((w) => w.ts >= cutoff);
  arr.push({ ts: Date.now(), amount: Math.round(amount) });
  winLog.set(userId, arr);
}

/** ¿Está exento? (owner del bot/servidor o administrador del servidor) */
function isStaff(interaction) {
  if (isOwner(interaction)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

/**
 * Comprueba si un usuario puede apostar `wager` ahora mismo.
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function check(interaction, wager) {
  if (isStaff(interaction)) return { ok: true };

  const userId = interaction.user.id;
  const c = AF();
  const sym = config.currency.symbol;

  // Cuenta de Discord nueva: apuesta limitada.
  const ageMs = Date.now() - interaction.user.createdTimestamp;
  if (ageMs < c.newAccountMaxAgeHours * HOUR && wager > c.newAccountMaxBet) {
    return {
      ok: false,
      error:
        `Tu cuenta de Discord es muy nueva (menos de ${c.newAccountMaxAgeHours}h). ` +
        `Máximo **${fmt(c.newAccountMaxBet)}** ${sym} por apuesta hasta que tenga más antigüedad.`,
    };
  }

  // Límite de apuestas por hora.
  if (recentBets(userId).length >= c.maxBetsPerHour) {
    return {
      ok: false,
      error: `Has alcanzado el límite de **${fmt(c.maxBetsPerHour)} apuestas por hora**. Descansa un rato e inténtalo luego.`,
    };
  }

  // Límite de ganancias por hora.
  if (wonLastHour(userId) >= c.maxWonPerHour) {
    return {
      ok: false,
      error: `Has alcanzado el límite de **${fmt(c.maxWonPerHour)}** ${sym} **ganados por hora**. Vuelve en un rato para seguir jugando.`,
    };
  }

  return { ok: true };
}

/** Engancha el registro de apuestas/ganancias. Llamar una vez en ClientReady. */
function attach() {
  gameEvents.on('result', (r) => {
    recordBet(r.userId);
    if (r.net > 0) recordWin(r.userId, r.net);
  });
}

module.exports = { check, attach, recordBet, recordWin, isStaff };
