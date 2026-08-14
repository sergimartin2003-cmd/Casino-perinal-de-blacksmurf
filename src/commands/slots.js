const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  getUser,
  placeBet,
  payout,
  recordResult,
  getJackpot,
  addJackpot,
  resetJackpot,
  recordJackpotWin,
} = require('../lib/economy');
const { announceJackpot } = require('../lib/gamelog');
const { jackpotEligibility } = require('../lib/eligibility');
const jackpotBoard = require('../lib/jackpotBoard');
const { resolveBet } = require('../lib/bet');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const { runGameLoop, replayRow } = require('../lib/replay');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WILD = '🃏';
// Rodillo ponderado.
const REEL = [
  '🍒', '🍒', '🍒', '🍒', '🍒',
  '🍋', '🍋', '🍋', '🍋',
  '🍇', '🍇', '🍇',
  '⭐', '⭐', '⭐',
  '🔔', '🔔',
  '7️⃣', '7️⃣',
  '💎',
  WILD,
];
// Multiplicador de BENEFICIO por línea de tres iguales (RTP ≈ 0.95, 3 líneas).
const PAY = { '🍒': 3, '🍋': 4, '🍇': 5, '⭐': 7, '🔔': 9, '7️⃣': 18, '💎': 40 };
const FULL_BONUS = 5; // pantalla completa: PAY[símbolo] × 5 extra

const spinReel = () => Array.from({ length: 3 }, () => REEL[Math.floor(Math.random() * REEL.length)]);

/** Símbolo ganador de una línea de 3 (con comodines) o null. */
function lineSymbol(line) {
  const nonWild = line.filter((s) => s !== WILD);
  if (nonWild.length === 0) return '💎'; // tres comodines = premio máximo
  const uniq = [...new Set(nonWild)];
  return uniq.length === 1 ? uniq[0] : null;
}

function render(cols, winRows) {
  const rows = [0, 1, 2].map((row) => {
    const line = cols.map((c) => c[row]).join(' │ ');
    return winRows && winRows.has(row) ? `✨ ${line} ✨` : `　 ${line} 　`;
  });
  return `╭─────────────────╮\n${rows.join('\n')}\n╰─────────────────╯`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('slots')
    .setDescription('🎰 Tragaperras Nova: 3 líneas, comodín y jackpot progresivo.')
    .addStringOption((o) =>
      o.setName('apuesta').setDescription('Cantidad a apostar (número, "half" o "all")').setRequired(true)
    ),

  async execute(interaction) {
    const u = getUser(interaction.user.id);
    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;

    const round = async () => {
      // Guard: si el saldo se agotó (p. ej. jugando en paralelo), no se juega gratis.
      if (!placeBet(interaction.user.id, wager)) {
        await interaction.editReply({ content: '❌ Te quedaste sin saldo para esta tirada.', embeds: [], components: [] }).catch(() => {});
        return;
      }
      addJackpot(wager * config.jackpot.contribution); // aportación en vivo (editable con /config)

      const cols = [spinReel(), spinReel(), spinReel()];
      const spinEmbed = (c) =>
        base(config.colors.primary)
          .setTitle('🎰  N O V A   S L O T S  🎰')
          .setDescription(render(c))
          .addFields(
            { name: 'Apuesta', value: coins(wager), inline: true },
            { name: '🏆 Jackpot', value: coins(getJackpot()), inline: true },
            { name: 'Comodín', value: `${WILD} sustituye todo`, inline: true }
          );

      // Animación: los rodillos se detienen uno a uno.
      await interaction.editReply({ embeds: [spinEmbed([spinReel(), spinReel(), spinReel()])], components: [] });
      await sleep(650);
      await interaction.editReply({ embeds: [spinEmbed([cols[0], spinReel(), spinReel()])], components: [] });
      await sleep(650);
      await interaction.editReply({ embeds: [spinEmbed([cols[0], cols[1], spinReel()])], components: [] });
      await sleep(650);

      // --- Evaluación: 3 líneas horizontales + pantalla completa ---
      const winRows = new Set();
      const winLabels = [];
      let mult = 0;
      const rowSyms = [0, 1, 2].map((row) => lineSymbol([cols[0][row], cols[1][row], cols[2][row]]));
      rowSyms.forEach((sym, row) => {
        if (sym) {
          mult += PAY[sym];
          winRows.add(row);
          winLabels.push(`Línea ${row + 1}: ${sym}${sym === '💎' && row === 1 ? ' + 🏆' : ''} · x${PAY[sym]}`);
        }
      });

      let fsSym = null;
      for (const sym of Object.keys(PAY)) if (cols.every((c) => c.every((s) => s === sym || s === WILD))) fsSym = sym;
      if (cols.every((c) => c.every((s) => s === WILD))) fsSym = '💎';
      if (fsSym) {
        mult += PAY[fsSym] * FULL_BONUS;
        winLabels.push(`💠 PANTALLA COMPLETA de ${fsSym} · x${PAY[fsSym] * FULL_BONUS}`);
      }

      // Jackpot: tres diamantes en la línea central revientan el bote común,
      // pero solo si el jugador pasa el filtro anti cuentas falsas.
      let jackpotWon = 0;
      if (rowSyms[1] === '💎') {
        const elig = jackpotEligibility(interaction.user);
        if (elig.eligible) {
          jackpotWon = getJackpot();
          resetJackpot();
          recordJackpotWin(interaction.user.id, jackpotWon);
        } else {
          const reqs = [`${config.jackpot.minAccountAgeDays} días de antigüedad`];
          if (config.jackpot.trackInvites) reqs.push(`${config.jackpot.minInvites} invitados`);
          winLabels.push(`💎💎💎 ¡Bote a tiro! Pero necesitas ${reqs.join(' o ')} para cobrarlo.`);
        }
      }

      const profit = Math.round(wager * mult);
      const pending = mult > 0 || jackpotWon > 0 ? wager + profit + jackpotWon : 0;
      const label = winLabels.length ? winLabels.join('\n') : '💨 Sin premio';

      payout(interaction.user.id, pending);
      const net = pending - wager;
      recordResult(interaction.user.id, { wagered: wager, net, game: 'slots' });

      const bal = getUser(interaction.user.id).balance;
      const color = net > 0 ? config.colors.gold : net === 0 ? config.colors.blurple : config.colors.red;
      const finalEmbed = base(color)
        .setTitle('🎰  N O V A   S L O T S  🎰')
        .setDescription(render(cols, winRows))
        .addFields({ name: 'Resultado', value: label, inline: false });
      if (jackpotWon > 0) finalEmbed.addFields({ name: '🏆 ¡JACKPOT GANADO!', value: `+${fmt(jackpotWon)} ${config.currency.symbol}`, inline: false });
      finalEmbed.addFields(
        { name: 'Apuesta', value: coins(wager), inline: true },
        { name: net >= 0 ? 'Ganancia neta' : 'Pérdida', value: `${net >= 0 ? '+' : ''}${fmt(net)} ${config.currency.symbol}`, inline: true },
        { name: 'Saldo', value: coins(bal), inline: true }
      );

      await interaction.editReply({ embeds: [finalEmbed], components: [replayRow(wager)] });

      // Aviso público a todo el servidor cuando alguien revienta el bote común.
      if (jackpotWon > 0) {
        announceJackpot(interaction.client, { userId: interaction.user.id, amount: jackpotWon }).catch(() => {});
      }
      // Refresca el tablero fijo (el bote creció con esta tirada o se reinició).
      jackpotBoard.refresh(interaction.client).catch(() => {});
    };

    await runGameLoop(interaction, wager, round);
  },
};
