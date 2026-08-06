const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const { getUser, placeBet, payout, recordResult } = require('../lib/economy');
const { resolveBet } = require('../lib/bet');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const { newDeck, renderCardBig, RANK_VALUE } = require('../lib/deck');
const { runGameLoop, replayRow } = require('../lib/replay');
const config = require('../config');

const EDGE = 0.98; // ligera ventaja de la casa en cada multiplicador

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hilo')
    .setDescription('🔼🔽 ¿La siguiente carta será mayor o menor? Encadena aciertos y retírate.')
    .addStringOption((o) =>
      o.setName('apuesta').setDescription('Cantidad a apostar').setRequired(true)
    ),

  async execute(interaction) {
    const u = getUser(interaction.user.id);
    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;
    const uid = interaction.user.id;

    const round = (response) =>
      new Promise((done) => {
        placeBet(uid, wager);
        const deck = newDeck();
        let current = deck.pop();
        let mult = 1;
        let streak = 0;
        let settled = false;

        const val = (c) => RANK_VALUE[c.rank];
        const pHigher = () => deck.filter((c) => val(c) > val(current)).length / deck.length;
        const pLower = () => deck.filter((c) => val(c) < val(current)).length / deck.length;
        const stepHigher = () => (pHigher() > 0 ? EDGE / pHigher() : 0);
        const stepLower = () => (pLower() > 0 ? EDGE / pLower() : 0);

        const pending = () => Math.round(wager * mult);

        const buttons = () => {
          const sh = stepHigher();
          const sl = stepLower();
          const ph = Math.round(pHigher() * 100);
          const pl = Math.round(pLower() * 100);
          return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('higher')
              .setLabel(`Mayor ${ph}% · x${sh ? sh.toFixed(2) : '—'}`)
              .setEmoji('🔼')
              .setStyle(ButtonStyle.Success)
              .setDisabled(sh === 0),
            new ButtonBuilder()
              .setCustomId('lower')
              .setLabel(`Menor ${pl}% · x${sl ? sl.toFixed(2) : '—'}`)
              .setEmoji('🔽')
              .setStyle(ButtonStyle.Danger)
              .setDisabled(sl === 0),
            new ButtonBuilder()
              .setCustomId('cash')
              .setLabel(`💰 Retirar (${fmt(pending())})`)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(streak === 0)
          );
        };

        const playEmbed = () => {
          const ph = Math.round(pHigher() * 100);
          const pl = Math.round(pLower() * 100);
          const tie = Math.max(0, 100 - ph - pl);
          return base(config.colors.primary)
            .setTitle('🔼🔽 Higher / Lower')
            .setDescription(`Carta actual:\n${renderCardBig(current)}`)
            .addFields(
              { name: 'Racha', value: `🔥 ${streak}`, inline: true },
              { name: 'Multiplicador', value: `x${mult.toFixed(2)}`, inline: true },
              { name: 'Acumulado', value: coins(pending()), inline: true },
              {
                name: 'Probabilidad',
                value: `🔼 Mayor **${ph}%**  ·  🔽 Menor **${pl}%**${tie > 0 ? `  ·  🟰 Empate **${tie}%** (pierdes)` : ''}`,
                inline: false,
              }
            );
        };

        interaction.editReply({ embeds: [playEmbed()], components: [buttons()] });

        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120000,
        });

        const settle = async (i, won, extraTitle, extraColor) => {
          if (settled) return;
          settled = true;
          collector.stop();
          const returned = won ? pending() : 0;
          const net = returned - wager;
          payout(uid, returned);
          recordResult(uid, { wagered: wager, net, game: 'hilo' });
          const bal = getUser(uid).balance;
          const embed = base(extraColor)
            .setTitle(extraTitle)
            .setDescription(`Última carta:\n${renderCardBig(current)}`)
            .addFields(
              { name: 'Racha final', value: `🔥 ${streak}`, inline: true },
              { name: won ? 'Ganancia' : 'Pérdida', value: `${net >= 0 ? '+' : ''}${fmt(net)} ${config.currency.symbol}`, inline: true },
              { name: 'Saldo', value: coins(bal), inline: true }
            );
          const payload = { embeds: [embed], components: [replayRow(wager)] };
          if (i) await i.update(payload).catch(() => {});
          else await interaction.editReply(payload).catch(() => {});
          done();
        };

        collector.on('collect', async (i) => {
          if (i.user.id !== uid) {
            return i.reply({ content: '❌ Esta partida no es tuya.', flags: MessageFlags.Ephemeral });
          }
          if (settled) return;

          if (i.customId === 'cash') return settle(i, true, '💰 Te retiraste', config.colors.gold);

          const guess = i.customId; // 'higher' | 'lower'
          const step = guess === 'higher' ? stepHigher() : stepLower();
          const next = deck.pop();
          const correct = guess === 'higher' ? val(next) > val(current) : val(next) < val(current);

          if (!correct) {
            current = next;
            return settle(i, false, '💀 Fallaste', config.colors.red);
          }

          mult *= step;
          streak++;
          current = next;

          // Sin cartas o tope alcanzado → cobro automático
          if (deck.length === 0 || pending() >= config.limits.maxBet) {
            return settle(i, true, '🏁 ¡Mazo agotado! Cobras', config.colors.gold);
          }
          await i.update({ embeds: [playEmbed()], components: [buttons()] });
        });

        collector.on('end', (_c, reason) => {
          if (!settled && reason === 'time') settle(null, streak > 0, '⌛ Tiempo agotado', config.colors.blurple);
        });
      });

    await runGameLoop(interaction, wager, round);
  },
};
