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
const { runGameLoop, replayRow } = require('../lib/replay');
const config = require('../config');

const COLS = 5;
const ROWS = 4;
const TILES = COLS * ROWS; // 20
const HOUSE_EDGE = 0.99;

/** Multiplicador acumulado tras revelar k gemas seguras. */
function multiplierAfter(k, mines) {
  let m = HOUSE_EDGE;
  for (let i = 0; i < k; i++) m *= (TILES - i) / (TILES - mines - i);
  return m;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mines')
    .setDescription('💣 Destapa gemas y esquiva las minas. Retírate antes de explotar.')
    .addStringOption((o) =>
      o.setName('apuesta').setDescription('Cantidad a apostar').setRequired(true)
    )
    .addIntegerOption((o) =>
      o
        .setName('minas')
        .setDescription('Número de minas (1-19, por defecto 3). Más minas = más multiplicador.')
        .setMinValue(1)
        .setMaxValue(TILES - 1)
    ),

  async execute(interaction) {
    const u = getUser(interaction.user.id);
    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;
    const mines = interaction.options.getInteger('minas') ?? 3;

    const round = (response) =>
      new Promise((done) => {
        placeBet(interaction.user.id, wager);

        const mineSet = new Set();
        while (mineSet.size < mines) mineSet.add(Math.floor(Math.random() * TILES));
        const revealed = new Set();
        let settled = false;
        let picks = 0;

        const currentMult = () => multiplierAfter(picks, mines);
        const nextMult = () => multiplierAfter(picks + 1, mines);

        const tileRows = (reveal) => {
          const rows = [];
          for (let row = 0; row < ROWS; row++) {
            const rowBtns = [];
            for (let col = 0; col < COLS; col++) {
              const idx = row * COLS + col;
              const isMine = mineSet.has(idx);
              const isRevealed = revealed.has(idx);
              const btn = new ButtonBuilder().setCustomId(`t_${idx}`);
              if (reveal) {
                btn
                  .setEmoji(isRevealed && isMine ? '💥' : isMine ? '💣' : isRevealed ? '💎' : '▪️')
                  .setStyle(isMine ? ButtonStyle.Danger : isRevealed ? ButtonStyle.Success : ButtonStyle.Secondary)
                  .setDisabled(true);
              } else if (isRevealed) {
                btn.setEmoji('💎').setStyle(ButtonStyle.Success).setDisabled(true);
              } else {
                btn.setEmoji('🟦').setStyle(ButtonStyle.Secondary).setDisabled(settled);
              }
              rowBtns.push(btn);
            }
            rows.push(new ActionRowBuilder().addComponents(rowBtns));
          }
          return rows;
        };

        const cashRow = () =>
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('cash')
              .setLabel(`💰 Retirar (${fmt(Math.round(wager * currentMult()))} ${config.currency.symbol})`)
              .setStyle(ButtonStyle.Primary)
              .setDisabled(picks === 0)
          );

        const infoEmbed = (color) =>
          base(color ?? config.colors.primary)
            .setTitle('💣 Mines')
            .addFields(
              { name: 'Apuesta', value: coins(wager), inline: true },
              { name: 'Minas', value: `💣 ${mines}`, inline: true },
              { name: 'Gemas', value: `💎 ${picks}`, inline: true },
              { name: 'Multiplicador', value: `**x${currentMult().toFixed(2)}**`, inline: true },
              { name: 'Siguiente gema', value: `x${nextMult().toFixed(2)}`, inline: true },
              { name: 'Retirar ahora', value: coins(Math.round(wager * currentMult())), inline: true }
            );

        interaction.editReply({ embeds: [infoEmbed()], components: [...tileRows(false), cashRow()] });

        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 180000,
        });

        const finish = async (i, embed) => {
          if (settled) return;
          settled = true;
          collector.stop();
          const payload = { embeds: [embed], components: [...tileRows(true), replayRow(wager)] };
          if (i) await i.update(payload).catch(() => {});
          else await interaction.editReply(payload).catch(() => {});
          done();
        };

        const cashOut = (i) => {
          const returned = Math.round(wager * currentMult());
          const net = returned - wager;
          payout(interaction.user.id, returned);
          recordResult(interaction.user.id, { wagered: wager, net, game: 'mines' });
          const bal = getUser(interaction.user.id).balance;
          const embed = base(config.colors.gold)
            .setTitle('💰 Te retiraste a tiempo')
            .setDescription(`Cobras con **x${currentMult().toFixed(2)}** tras ${picks} 💎`)
            .addFields(
              { name: 'Ganancia', value: `+${fmt(net)} ${config.currency.symbol}`, inline: true },
              { name: 'Total cobrado', value: coins(returned), inline: true },
              { name: 'Saldo', value: coins(bal), inline: true }
            );
          return finish(i, embed);
        };

        const boom = (i) => {
          recordResult(interaction.user.id, { wagered: wager, net: -wager, game: 'mines' });
          const bal = getUser(interaction.user.id).balance;
          const embed = base(config.colors.red)
            .setTitle('💥 ¡BOOM! Pisaste una mina')
            .setDescription(`Perdiste tras ${picks} 💎`)
            .addFields(
              { name: 'Pérdida', value: `-${fmt(wager)} ${config.currency.symbol}`, inline: true },
              { name: 'Saldo', value: coins(bal), inline: true }
            );
          return finish(i, embed);
        };

        collector.on('collect', async (i) => {
          if (i.user.id !== interaction.user.id) {
            return i.reply({ content: '❌ Esta partida no es tuya.', flags: MessageFlags.Ephemeral });
          }
          if (settled) return;
          if (i.customId === 'cash') return cashOut(i);

          const idx = Number(i.customId.split('_')[1]);
          if (revealed.has(idx)) return i.deferUpdate();

          if (mineSet.has(idx)) {
            revealed.add(idx);
            return boom(i);
          }
          revealed.add(idx);
          picks++;
          if (picks === TILES - mines) return cashOut(i); // todas las gemas
          await i.update({ embeds: [infoEmbed()], components: [...tileRows(false), cashRow()] });
        });

        collector.on('end', (_c, reason) => {
          if (settled || reason !== 'time') return;
          if (picks > 0) {
            const returned = Math.round(wager * currentMult());
            payout(interaction.user.id, returned);
            recordResult(interaction.user.id, { wagered: wager, net: returned - wager, game: 'mines' });
          } else {
            recordResult(interaction.user.id, { wagered: wager, net: -wager, game: 'mines' });
          }
          settled = true;
          const embed = base(config.colors.blurple)
            .setTitle('⌛ Tiempo agotado')
            .setDescription(picks > 0 ? `Cobras automáticamente ${picks} 💎.` : 'No destapaste nada.');
          interaction.editReply({ embeds: [embed], components: [...tileRows(true), replayRow(wager)] }).catch(() => {});
          done();
        });
      });

    await runGameLoop(interaction, wager, round);
  },
};
