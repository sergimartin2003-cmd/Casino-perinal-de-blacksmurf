const config = require('../config');

/** 12345 -> "12,345" */
function fmt(n) {
  return Math.round(n).toLocaleString('en-US');
}

/** Cantidad con símbolo de moneda, en negrita. */
function coins(n) {
  return `**${fmt(n)}** ${config.currency.symbol}`;
}

/** Barra de progreso tipo [█████░░░░░] para rachas, multiplicadores, etc. */
function bar(value, max, size = 10) {
  const filled = Math.max(0, Math.min(size, Math.round((value / max) * size)));
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

module.exports = { fmt, coins, bar };
