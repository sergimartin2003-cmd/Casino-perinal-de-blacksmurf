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
const { newDeck, renderCard, RANK_VALUE } = require('../lib/deck');
const { runGameLoop, replayRow } = require('../lib/replay');
const config = require('../config');

// Tabla de pagos (multiplicador de BENEFICIO) — estilo "Jacks or Better".
const PAYTABLE = [
  { name: '👑 Escalera Real', mult: 250 },
  { name: '🌈 Escalera de Color', mult: 50 },
  { name: '💣 Póker (4 iguales)', mult: 25 },
  { name: '🏠 Full', mult: 9 },
  { name: '🎨 Color', mult: 6 },
  { name: '📈 Escalera', mult: 4 },
  { name: '🎲 Trío', mult: 3 },
  { name: '👥 Doble Pareja', mult: 2 },
  { name: '🔒 Pareja de J o mejor', mult: 1 },
];

function evaluate(hand) {
  const values = hand.map((c) => RANK_VALUE[c.rank]).sort((a, b) => a - b);
  const suits = hand.map((c) => c.suit.s);
  const isFlush = suits.every((s) => s === suits[0]);

  const isWheel = JSON.stringify(values) === JSON.stringify([2, 3, 4, 5, 14]); // A-2-3-4-5
  const isStraight = (new Set(values).size === 5 && values[4] - values[0] === 4) || isWheel;

  const counts = {};
  for (const v of values) counts[v] = (counts[v] || 0) + 1;
  const countVals = Object.values(counts).sort((a, b) => b - a);

  const isRoyal = isFlush && isStraight && !isWheel && values[0] === 10;

  if (isRoyal) return PAYTABLE[0];
  if (isFlush && isStraight) return PAYTABLE[1];
  if (countVals[0] === 4) return PAYTABLE[2];
  if (countVals[0] === 3 && countVals[1] === 2) return PAYTABLE[3];
  if (isFlush) return PAYTABLE[4];
  if (isStraight) return PAYTABLE[5];
  if (countVals[0] === 3) return PAYTABLE[6];
  if (countVals[0] === 2 && countVals[1] === 2) return PAYTABLE[7];
  if (countVals[0] === 2) {
    const pairVal = Number(Object.keys(counts).find((k) => counts[k] === 2));
    if (pairVal >= 11) return PAYTABLE[8];
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poker')
    .setDescription('🎴 Video póker (Jacks or Better): retén cartas y cambia el resto.')
    .addStringOption((o) =>
      o.setName('apuesta').setDescription('Cantidad a apostar').setRequired(true)
    ),

  async execute(interaction) {
    const u = getUser(interaction.user.id);
    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;

    const paytableText = PAYTABLE.map((p) => `${p.name} — **x${p.mult}**`).join('\n');

    const round = (response) =>
      new Promise((done) => {
        if (!placeBet(interaction.user.id, wager)) {
          interaction.editReply({ content: '❌ Te quedaste sin saldo para esta ronda.', embeds: [], components: [] }).catch(() => {});
          return done();
        }
        const deck = newDeck();
        const hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
        const held = [false, false, false, false, false];
        let settled = false;

        const handRow = (disabled) =>
          new ActionRowBuilder().addComponents(
            hand.map((c, idx) =>
              new ButtonBuilder()
                .setCustomId(`hold_${idx}`)
                .setLabel(`${c.rank}${c.suit.s}`)
                .setStyle(held[idx] ? ButtonStyle.Success : ButtonStyle.Secondary)
                .setDisabled(disabled)
            )
          );

        const actionRow = () =>
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('draw')
              .setLabel('Cambiar y mostrar')
              .setEmoji('🔄')
              .setStyle(ButtonStyle.Primary)
          );

        const drawEmbed = () =>
          base(config.colors.primary)
            .setTitle('🎴 Video Póker — Jacks or Better')
            .setDescription(
              `Tu mano:\n## ${hand.map(renderCard).join(' ')}\n\n` +
                `Pulsa las cartas que quieres **conservar** (se ponen en verde) y luego **Cambiar y mostrar**.`
            )
            .addFields(
              { name: 'Apuesta', value: coins(wager), inline: true },
              { name: '💰 Tabla de pagos', value: paytableText, inline: false }
            );

        interaction.editReply({ embeds: [drawEmbed()], components: [handRow(false), actionRow()] });

        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120000,
        });

        const resolve = async (i) => {
          if (settled) return;
          settled = true;
          collector.stop();

          const result = evaluate(hand);
          const mult = result ? result.mult : 0;
          const net = result ? wager * mult : -wager;
          payout(interaction.user.id, result ? wager + wager * mult : 0);
          recordResult(interaction.user.id, { wagered: wager, net, game: 'poker' });

          const bal = getUser(interaction.user.id).balance;
          const win = !!result;
          const embed = base(win ? config.colors.gold : config.colors.red)
            .setTitle('🎴 Video Póker — resultado')
            .setDescription(`## ${hand.map(renderCard).join(' ')}`)
            .addFields(
              { name: 'Mano', value: win ? `✨ **${result.name}**` : '💨 Sin premio', inline: false },
              {
                name: win ? 'Ganancia' : 'Pérdida',
                value: win ? `+${fmt(net)} ${config.currency.symbol} (x${mult})` : `-${fmt(wager)} ${config.currency.symbol}`,
                inline: true,
              },
              { name: 'Saldo', value: coins(bal), inline: true }
            );
          const payload = { embeds: [embed], components: [handRow(true), replayRow(wager)] };
          if (i) await i.update(payload).catch(() => {});
          else await interaction.editReply(payload).catch(() => {});
          done();
        };

        collector.on('collect', async (i) => {
          if (i.user.id !== interaction.user.id) {
            return i.reply({ content: '❌ Esta partida no es tuya.', flags: MessageFlags.Ephemeral });
          }
          if (settled) return;
          if (i.customId.startsWith('hold_')) {
            const idx = Number(i.customId.split('_')[1]);
            held[idx] = !held[idx];
            return i.update({ embeds: [drawEmbed()], components: [handRow(false), actionRow()] });
          }
          if (i.customId === 'draw') {
            for (let idx = 0; idx < 5; idx++) if (!held[idx]) hand[idx] = deck.pop();
            return resolve(i);
          }
        });

        collector.on('end', (_c, reason) => {
          if (!settled && reason === 'time') resolve(null);
        });
      });

    await runGameLoop(interaction, wager, round);
  },
};
