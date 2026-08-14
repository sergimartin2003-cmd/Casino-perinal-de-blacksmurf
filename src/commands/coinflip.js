const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getUser, placeBet, payout, recordResult } = require('../lib/economy');
const { resolveBet } = require('../lib/bet');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const { runGameLoop, replayRow } = require('../lib/replay');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinflip')
    .setDescription('🪙 Cara o cruz. Doble o nada.')
    .addStringOption((o) =>
      o
        .setName('lado')
        .setDescription('¿Cara o cruz?')
        .setRequired(true)
        .addChoices({ name: 'Cara', value: 'cara' }, { name: 'Cruz', value: 'cruz' })
    )
    .addStringOption((o) =>
      o.setName('apuesta').setDescription('Cantidad a apostar').setRequired(true)
    ),

  async execute(interaction) {
    const u = getUser(interaction.user.id);
    const pick = interaction.options.getString('lado');
    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;

    const round = async () => {
      if (!placeBet(interaction.user.id, wager)) {
        await interaction.editReply({ content: '❌ Te quedaste sin saldo para esta ronda.', embeds: [], components: [] }).catch(() => {});
        return;
      }
      await interaction.editReply({
        embeds: [base(config.colors.primary).setTitle('🪙 Lanzando la moneda…').setDescription('🔄 girando…')],
        components: [],
      });
      await sleep(1100);

      const result = Math.random() < 0.5 ? 'cara' : 'cruz';
      const win = result === pick;
      const face = result === 'cara' ? '🙂 Cara' : '✖️ Cruz';

      payout(interaction.user.id, win ? wager * 2 : 0);
      recordResult(interaction.user.id, { wagered: wager, net: win ? wager : -wager, game: 'coinflip' });

      const bal = getUser(interaction.user.id).balance;
      const embed = base(win ? config.colors.green : config.colors.red)
        .setTitle(`🪙 Salió ${face}`)
        .setDescription(win ? '🎉 **¡Ganaste!**' : '💀 **Perdiste.**')
        .addFields(
          { name: 'Tu elección', value: pick === 'cara' ? '🙂 Cara' : '✖️ Cruz', inline: true },
          { name: win ? 'Ganancia' : 'Pérdida', value: `${win ? '+' : '-'}${fmt(wager)} ${config.currency.symbol}`, inline: true },
          { name: 'Saldo', value: coins(bal), inline: true }
        );
      await interaction.editReply({ embeds: [embed], components: [replayRow(wager)] });
    };

    await runGameLoop(interaction, wager, round);
  },
};
