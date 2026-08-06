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
const { newDeck, handValue, renderHand } = require('../lib/deck');
const { runGameLoop, replayRow } = require('../lib/replay');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blackjack')
    .setDescription('🃏 Blackjack contra la banca (pedir, plantar, doblar, dividir y seguro).')
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
        const hands = [
          { cards: [deck.pop(), deck.pop()], stake: wager, done: false, bust: false, doubled: false, split: false },
        ];
        const dealer = [deck.pop(), deck.pop()];
        hands[0].blackjack = handValue(hands[0].cards) === 21;
        let active = 0;
        let insurance = 0;
        let settled = false;

        const bal = () => getUser(uid).balance;
        const canDouble = () => hands[active].cards.length === 2 && bal() >= wager;
        const canSplit = () =>
          hands.length === 1 &&
          hands[0].cards.length === 2 &&
          hands[0].cards[0].rank === hands[0].cards[1].rank &&
          bal() >= wager;

        const playButtons = () =>
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('hit').setLabel('Pedir').setEmoji('🎯').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('stand').setLabel('Plantarse').setEmoji('✋').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('double').setLabel('Doblar').setEmoji('⏫').setStyle(ButtonStyle.Success).setDisabled(!canDouble()),
            new ButtonBuilder().setCustomId('split').setLabel('Dividir').setEmoji('✂️').setStyle(ButtonStyle.Success).setDisabled(!canSplit())
          );

        const insuranceButtons = () =>
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ins_yes').setLabel(`Sí (${fmt(Math.floor(wager / 2))})`).setEmoji('🛡️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('ins_no').setLabel('No').setEmoji('🚫').setStyle(ButtonStyle.Secondary)
          );

        const handsField = () =>
          hands.map((h, idx) => {
            const marker = hands.length > 1 ? (idx === active && !settled ? '▶ ' : '　') : '';
            const tag = hands.length > 1 ? `Mano ${idx + 1}` : 'Tú';
            const flags = [h.bust ? '💥' : '', h.doubled ? '⏫' : '', h.blackjack ? '🌟' : ''].join('');
            return { name: `🧑 ${marker}${tag} — ${handValue(h.cards)} ${flags}`.trim(), value: renderHand(h.cards), inline: false };
          });

        const renderPlay = (color = config.colors.primary) => ({
          embeds: [
            base(color)
              .setTitle('🃏 Blackjack')
              .addFields(
                ...handsField(),
                { name: '🤖 Banca — ?', value: `${renderHand([dealer[0]])} \`??\``, inline: false },
                { name: 'Apuesta', value: coins(hands.reduce((s, h) => s + h.stake, 0) + insurance), inline: true }
              ),
          ],
          components: [playButtons()],
        });

        const insuranceEmbed = () => ({
          embeds: [
            base(config.colors.gold)
              .setTitle('🃏 Blackjack — ¿Seguro?')
              .setDescription('La banca muestra un **As**. ¿Quieres seguro? Cuesta la mitad de tu apuesta y paga 2:1 si la banca tiene blackjack.')
              .addFields(
                { name: `🧑 Tú — ${handValue(hands[0].cards)}`, value: renderHand(hands[0].cards), inline: false },
                { name: '🤖 Banca', value: `${renderHand([dealer[0]])} \`??\``, inline: false }
              ),
          ],
          components: [insuranceButtons()],
        });

        function dealerPlay() {
          if (hands.some((h) => !h.bust)) {
            while (handValue(dealer) < 17) dealer.push(deck.pop());
          }
        }

        const settle = async (i) => {
          if (settled) return;
          settled = true;
          collector.stop();

          const dVal = handValue(dealer);
          const dealerBJ = dealer.length === 2 && dVal === 21;

          let wagered = insurance;
          let returned = 0;
          const lines = [];

          if (insurance > 0) {
            if (dealerBJ) returned += insurance * 3;
            lines.push(dealerBJ ? `🛡️ Seguro: **ganado** (+${fmt(insurance * 2)})` : `🛡️ Seguro: perdido (-${fmt(insurance)})`);
          }

          hands.forEach((h, idx) => {
            wagered += h.stake;
            const pv = handValue(h.cards);
            const tag = hands.length > 1 ? `Mano ${idx + 1}` : 'Mano';
            if (h.bust) {
              lines.push(`${tag}: 💥 pasada (-${fmt(h.stake)})`);
            } else if (h.blackjack && !dealerBJ) {
              const g = Math.floor(h.stake * 1.5);
              returned += h.stake + g;
              lines.push(`${tag}: 🌟 blackjack (+${fmt(g)})`);
            } else if (dealerBJ && !h.blackjack) {
              lines.push(`${tag}: banca con BJ (-${fmt(h.stake)})`);
            } else if (dVal > 21 || pv > dVal) {
              returned += h.stake * 2;
              lines.push(`${tag}: 🎉 ganada (+${fmt(h.stake)})`);
            } else if (pv === dVal) {
              returned += h.stake;
              lines.push(`${tag}: 🤝 empate`);
            } else {
              lines.push(`${tag}: 💀 perdida (-${fmt(h.stake)})`);
            }
          });

          payout(uid, returned);
          const net = returned - wagered;
          recordResult(uid, { wagered, net, game: 'blackjack' });

          const color = net > 0 ? config.colors.gold : net === 0 ? config.colors.blurple : config.colors.red;
          const embed = base(color)
            .setTitle('🃏 Blackjack — resultado')
            .addFields(
              ...handsField(),
              { name: `🤖 Banca — ${dVal}${dealerBJ ? ' 🌟' : ''}`, value: renderHand(dealer), inline: false },
              { name: 'Detalle', value: lines.join('\n'), inline: false },
              { name: net >= 0 ? 'Ganancia neta' : 'Pérdida', value: `${net >= 0 ? '+' : ''}${fmt(net)} ${config.currency.symbol}`, inline: true },
              { name: 'Saldo', value: coins(bal()), inline: true }
            );
          const payload = { embeds: [embed], components: [replayRow(wager)] };
          if (i) await i.update(payload).catch(() => {});
          else await interaction.editReply(payload).catch(() => {});
          done();
        };

        const nextHand = (i) => {
          const idx = hands.findIndex((h) => !h.done);
          if (idx === -1) {
            dealerPlay();
            return settle(i);
          }
          active = idx;
          return i.update(renderPlay());
        };

        const collector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 120000,
        });

        collector.on('collect', async (i) => {
          if (i.user.id !== uid) {
            return i.reply({ content: '❌ Esta partida no es tuya.', flags: MessageFlags.Ephemeral });
          }
          if (settled) return;
          const h = hands[active];

          // --- Seguro ---
          if (i.customId === 'ins_yes' || i.customId === 'ins_no') {
            if (i.customId === 'ins_yes' && bal() >= Math.floor(wager / 2)) {
              insurance = Math.floor(wager / 2);
              placeBet(uid, insurance);
            }
            if (handValue(dealer) === 21) return settle(i); // banca con blackjack
            if (hands[0].blackjack) return settle(i); // jugador con blackjack
            return i.update(renderPlay());
          }

          // --- Dividir ---
          if (i.customId === 'split') {
            if (!canSplit()) return i.deferUpdate();
            const rank = h.cards[0].rank;
            placeBet(uid, wager);
            const h1 = { cards: [h.cards[0], deck.pop()], stake: wager, done: false, bust: false, doubled: false, split: true, blackjack: false };
            const h2 = { cards: [h.cards[1], deck.pop()], stake: wager, done: false, bust: false, doubled: false, split: true, blackjack: false };
            hands.splice(0, 1, h1, h2);
            active = 0;
            if (rank === 'A') {
              // Ases divididos: una carta cada uno y se plantan.
              h1.done = true;
              h2.done = true;
              dealerPlay();
              return settle(i);
            }
            return i.update(renderPlay());
          }

          // --- Doblar ---
          if (i.customId === 'double') {
            if (!canDouble()) return i.deferUpdate();
            placeBet(uid, wager);
            h.stake += wager;
            h.doubled = true;
            h.cards.push(deck.pop());
            if (handValue(h.cards) > 21) h.bust = true;
            h.done = true;
            return nextHand(i);
          }

          // --- Pedir ---
          if (i.customId === 'hit') {
            h.cards.push(deck.pop());
            if (handValue(h.cards) > 21) {
              h.bust = true;
              h.done = true;
              return nextHand(i);
            }
            return i.update(renderPlay());
          }

          // --- Plantarse ---
          if (i.customId === 'stand') {
            h.done = true;
            return nextHand(i);
          }
        });

        collector.on('end', (_c, reason) => {
          if (!settled && reason === 'time') {
            dealerPlay();
            settle(null);
          }
        });

        // --- Arranque de la ronda ---
        if (dealer[0].rank === 'A') {
          interaction.editReply(insuranceEmbed());
        } else if (handValue(dealer) === 21 || hands[0].blackjack) {
          // Peek: la banca con 10 visible ya se resuelve; o blackjack del jugador.
          settle(null);
        } else {
          interaction.editReply(renderPlay());
        }
      });

    await runGameLoop(interaction, wager, round);
  },
};
