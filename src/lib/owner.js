const config = require('../config');

/** ¿Quien ejecuta es owner del bot (config.owners) o dueño del servidor? */
function isOwner(interaction) {
  const uid = interaction.user.id;
  if (Array.isArray(config.owners) && config.owners.includes(uid)) return true;
  if (interaction.guild && interaction.guild.ownerId === uid) return true;
  return false;
}

module.exports = { isOwner };
