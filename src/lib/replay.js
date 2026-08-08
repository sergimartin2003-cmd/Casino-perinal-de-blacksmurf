const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getUser } = require('./economy');
const antifraud = require('./antifraud');
const { fmt } = require('./format');
const config = require('../config');

/** Fila con el botón "Volver a jugar (misma apuesta)". */
function replayRow(wager, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('replay')
      .setLabel(`Volver a jugar · ${fmt(wager)} ${config.currency.symbol}`)
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

/** Espera a que el jugador pulse "Volver a jugar". Resuelve true si repite. */
function waitReplay(response, interaction, wager) {
  return new Promise((resolve) => {
    const collector = response.createMessageComponentCollector({
      filter: (i) => i.customId === 'replay',
      time: 90000,
    });
    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i
          .reply({ content: '❌ Este juego no es tuyo. Usa el comando para jugar tú.', flags: MessageFlags.Ephemeral })
          .catch(() => {});
      }
      const bal = getUser(interaction.user.id).balance;
      if (bal < wager) {
        return i
          .reply({
            content: `❌ Necesitas ${fmt(wager)} ${config.currency.symbol} para repetir y solo tienes ${fmt(bal)}.`,
            flags: MessageFlags.Ephemeral,
          })
          .catch(() => {});
      }
      const guard = antifraud.check(interaction, wager);
      if (!guard.ok) {
        return i.reply({ content: `❌ ${guard.error}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      await i.deferUpdate().catch(() => {});
      collector.stop('again');
      resolve(true);
    });
    collector.on('end', (_c, reason) => {
      if (reason !== 'again') resolve(false);
    });
  });
}

/**
 * Bucle de juego con "Volver a jugar".
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} wager
 * @param {(response) => Promise<void>} round  juega una ronda completa; debe terminar
 *        editando el mensaje e incluyendo replayRow(wager) en components.
 */
async function runGameLoop(interaction, wager, round) {
  await interaction.deferReply();
  const guard = antifraud.check(interaction, wager);
  if (!guard.ok) {
    return interaction.editReply({ content: `❌ ${guard.error}` }).catch(() => {});
  }
  const response = await interaction.fetchReply();
  do {
    await round(response);
  } while (await waitReplay(response, interaction, wager));
  await interaction.editReply({ components: [replayRow(wager, true)] }).catch(() => {});
}

module.exports = { replayRow, waitReplay, runGameLoop };
