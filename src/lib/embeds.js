const { EmbedBuilder } = require('discord.js');
const config = require('../config');

/** Embed base con la marca del casino. */
function base(color = config.colors.primary) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: `${config.casino.name} • fichas ficticias, cero dinero real` })
    .setTimestamp();
}

module.exports = { base };
