const config = require('../config');
const { getInviteCount } = require('./economy');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ¿Puede este usuario COBRAR el jackpot? (anti cuentas falsas)
 * Elegible si cumple AL MENOS UNA condición: cuenta de Discord con
 * suficiente antigüedad, o suficientes invitaciones acreditadas.
 * @param {import('discord.js').User} user
 * @returns {{ eligible: boolean, ageDays: number, invites: number }}
 */
function jackpotEligibility(user) {
  const ageDays = Math.floor((Date.now() - user.createdTimestamp) / DAY_MS);
  const invites = getInviteCount(user.id);
  const { minAccountAgeDays, minInvites } = config.jackpot;
  const eligible = ageDays >= minAccountAgeDays || invites >= minInvites;
  return { eligible, ageDays, invites };
}

module.exports = { jackpotEligibility };
