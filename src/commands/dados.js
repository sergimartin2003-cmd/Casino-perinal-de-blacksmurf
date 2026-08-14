const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getUser, placeBet, payout, recordResult } = require('../lib/economy');
const { resolveBet } = require('../lib/bet');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const { runGameLoop, replayRow } = require('../lib/replay');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DICE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const roll = () => 1 + Math.floor(Math.random() * 6);

// Predicciones sobre la suma de 2 dados frente al 7.
const BETS = {
  bajo: { label: '⬇️ Menor que 7 (2-6)', mult: 1.3, hit: (s) => s < 7 },
  siete: { label: '🎯 Exactamente 7', mult: 4.5, hit: (s) => s === 7 },
  alto: { label: '⬆️ Mayor que 7 (8-12)', mult: 1.3, hit: (s) => s > 7 },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dados')
    .setDescription('🎲 Tira dos dados y predice si la suma será menor, igual o mayor que 7.')
    .addStringOption((o) =>
      o
        .setName('prediccion')
        .setDescription('Tu predicción')
        .setRequired(true)
        .addChoices(
          { name: '⬇️ Menor que 7 (x2.3)', value: 'bajo' },
          { name: '🎯 Exactamente 7 (x5.5)', value: 'siete' },
          { name: '⬆️ Mayor que 7 (x2.3)', value: 'alto' }
        )
    )
    .addStringOption((o) =>
      o.setName('apuesta').setDescription('Cantidad a apostar').setRequired(true)
    ),

  async execute(interaction) {
    const u = getUser(interaction.user.id);
    const type = interaction.options.getString('prediccion');
    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;
    const betDef = BETS[type];

    const round = async () => {
      if (!placeBet(interaction.user.id, wager)) {
        await interaction.editReply({ content: '❌ Te quedaste sin saldo para esta ronda.', embeds: [], components: [] }).catch(() => {});
        return;
      }

      // Animación de tirada
      for (let i = 0; i < 3; i++) {
        await interaction.editReply({
          embeds: [
            base(config.colors.primary)
              .setTitle('🎲 Rodando los dados…')
              .setDescription(`# ${DICE[roll() - 1]} ${DICE[roll() - 1]}`)
              .addFields({ name: 'Tu predicción', value: `${betDef.label} • ${coins(wager)}` }),
          ],
          components: [],
        });
        await sleep(550);
      }

      const d1 = roll();
      const d2 = roll();
      const sum = d1 + d2;
      const win = betDef.hit(sum);
      const net = win ? Math.round(wager * betDef.mult) : -wager;

      payout(interaction.user.id, win ? wager + Math.round(wager * betDef.mult) : 0);
      recordResult(interaction.user.id, { wagered: wager, net, game: 'dados' });

      const bal = getUser(interaction.user.id).balance;
      const embed = base(win ? config.colors.green : config.colors.red)
        .setTitle(`🎲 ${DICE[d1 - 1]} ${DICE[d2 - 1]}  =  ${sum}`)
        .setDescription(win ? '🎉 **¡Acertaste!**' : '💀 **Fallaste.**')
        .addFields(
          { name: 'Tu predicción', value: betDef.label, inline: true },
          { name: win ? 'Ganancia' : 'Pérdida', value: `${win ? '+' : '-'}${fmt(Math.abs(net))} ${config.currency.symbol}`, inline: true },
          { name: 'Saldo', value: coins(bal), inline: true }
        );
      await interaction.editReply({ embeds: [embed], components: [replayRow(wager)] });
    };

    await runGameLoop(interaction, wager, round);
  },
};
