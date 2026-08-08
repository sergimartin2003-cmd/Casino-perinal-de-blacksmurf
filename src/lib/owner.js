const { PermissionFlagsBits } = require('discord.js');
const config = require('../config');

/** ¿Quien ejecuta es owner del bot (config.owners) o dueño del servidor? */
function isOwner(interaction) {
  const uid = interaction.user.id;
  if (Array.isArray(config.owners) && config.owners.includes(uid)) return true;
  if (interaction.guild && interaction.guild.ownerId === uid) return true;
  return false;
}

/** ¿Es "staff"? = owner (arriba) O Administrador del servidor. */
function isStaff(interaction) {
  if (isOwner(interaction)) return true;
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
}

module.exports = { isOwner, isStaff };
