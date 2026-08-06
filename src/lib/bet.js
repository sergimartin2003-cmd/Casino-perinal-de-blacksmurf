const config = require('../config');
const { fmt } = require('./format');

/**
 * Interpreta la apuesta escrita por el usuario.
 * Admite: números (100, 1.5k, 2m), "all/todo/max", "half/mitad".
 * @returns {{ amount: number } | { error: string }}
 */
function resolveBet(input, balance) {
  if (input === null || input === undefined || input === '')
    return { error: 'Indica una apuesta.' };

  const raw = String(input).trim().toLowerCase();
  let amount;

  if (['all', 'todo', 'max', 'allin', 'all-in'].includes(raw)) {
    amount = balance;
  } else if (['half', 'mitad'].includes(raw)) {
    amount = Math.floor(balance / 2);
  } else {
    const m = raw.match(/^([\d.,]+)\s*([km])?$/);
    if (!m) return { error: 'Apuesta no válida. Prueba con un número, `all` o `half`.' };
    amount = parseFloat(m[1].replace(/,/g, ''));
    if (m[2] === 'k') amount *= 1e3;
    if (m[2] === 'm') amount *= 1e6;
    amount = Math.floor(amount);
  }

  if (!Number.isFinite(amount) || amount <= 0)
    return { error: 'Apuesta no válida.' };
  if (balance <= 0)
    return { error: 'Estás sin fondos. Usa `/daily` para conseguir Novas.' };
  if (amount < config.limits.minBet)
    return { error: `La apuesta mínima es ${fmt(config.limits.minBet)} ${config.currency.symbol}.` };
  if (amount > config.limits.maxBet)
    return { error: `La apuesta máxima es ${fmt(config.limits.maxBet)} ${config.currency.symbol}.` };
  if (amount > balance)
    return { error: `No tienes saldo suficiente. Tu saldo: ${fmt(balance)} ${config.currency.symbol}.` };

  return { amount };
}

module.exports = { resolveBet };
