const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} = require('discord.js');
const { getUser, placeBet, payout, recordResult } = require('../lib/economy');
const { resolveBet } = require('../lib/bet');
const antifraud = require('../lib/antifraud');
const { base } = require('../lib/embeds');
const { coins, fmt } = require('../lib/format');
const config = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TRACK = 18; // longitud de la pista
const TAGS = ['🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '🟫', '⬜'];

// Conjunto FIJO de 8 cuotas (odds/1). Cada carrera se barajan y se reparten
// entre 8 nombres al azar, así el cartel cambia pero la ventaja de la casa se
// mantiene: prob de ganar ∝ 1/(odds+1) → ventaja uniforme (~10%) en todos.
const ODDS_SET = [3, 4, 5, 6, 7, 9, 12, 18];
// Nombres del Inside Track de GTA Online traducidos al español (con su coña).
const NAME_POOL = [
  'Cabo Suelto', 'Huevo Podrido', 'Tanga Banana', 'Mejor que Nada', 'Béeeme Otra Vez',
  'Cheque Cancelado', 'Imposible Ir Peor', 'Carlos Respondón', 'Fardón Perpetuo', 'Pan con Porfa',
  'Dentista Rarito', 'Colega Finao', 'Doctor Divorciado', 'Pelandusca Chusca', 'Doctor Rienda Suelta',
  'Rompesueños', 'Brandi Borracha', 'Alimenta al Troll', 'Poniéndose Chulo', 'Corcel de Hennigan',
  'Caliente y Sofocada', 'Granada a la Carga', '¡Es una Trampa!', 'Hermanastro Solitario', 'Salvador de Los Santos',
  'Sarampión Charampión', 'Microagresión', 'Apuesta Mínima', 'Señorita Ofendida', 'Señor Censurado',
  'Señor Tijeras', 'Dinero para Quemar', 'Don Vale la Pena', 'Guapa como una Pistola', 'Dignidad Dudosa',
  'Robollamada', 'Picado y Woke', 'Jamelgo Escuálido', 'Sir Revuelto', 'Guerrero del Teclado',
  'Cuadriculado Total', 'Compi de Estudio', 'Pasta Gansa', 'Impuestos al Pobre', 'Poli Tenpenny',
  '¡Ahí Resopla!', 'Lanzando Pullas', 'Un Pepino', 'Modo Fiesta', 'Jinete de Postín', 'Vale un Reino',
];

function shuffle(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Genera el cartel de 8 caballos de una carrera (nombres al azar + cuotas). */
function makeLineup() {
  const names = shuffle(NAME_POOL).slice(0, 8);
  const odds = shuffle(ODDS_SET);
  const horses = names.map((name, i) => ({ name, odds: odds[i] }));
  horses.sort((a, b) => a.odds - b.odds); // favoritos primero
  return horses.map((h, i) => ({ ...h, tag: `${TAGS[i]} ${i + 1}`, emoji: '🐎', weight: 1 / (h.odds + 1) }));
}

/** Elige el ganador ponderando por probabilidad (favoritos ganan más). */
function pickWinner(lineup) {
  const total = lineup.reduce((s, h) => s + h.weight, 0);
  let r = Math.random() * total;
  for (let i = 0; i < lineup.length; i++) {
    if (r < lineup[i].weight) return i;
    r -= lineup[i].weight;
  }
  return lineup.length - 1;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('carrera')
    .setDescription('🏇 Carrera estilo GTA: 8 caballos que cambian cada vez, cada uno con su cuota.')
    .addStringOption((o) => o.setName('apuesta').setDescription('Cantidad a apostar').setRequired(true)),

  async execute(interaction) {
    const userId = interaction.user.id;
    const u = getUser(userId);
    const r = resolveBet(interaction.options.getString('apuesta'), u.balance);
    if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral });
    const wager = r.amount;

    await interaction.deferReply();
    const response = await interaction.fetchReply();

    /** Juega una carrera completa. Devuelve true si el jugador quiere otra. */
    async function playOne() {
      if (getUser(userId).balance < wager) {
        await interaction
          .editReply({
            embeds: [base(config.colors.red).setTitle('🏇 Carreras').setDescription(`Necesitas ${coins(wager)} y no te llega.`)],
            components: [],
          })
          .catch(() => {});
        return false;
      }

      const guard = antifraud.check(interaction, wager);
      if (!guard.ok) {
        await interaction
          .editReply({
            embeds: [base(config.colors.red).setTitle('🏇 Carreras').setDescription(`❌ ${guard.error}`)],
            components: [],
          })
          .catch(() => {});
        return false;
      }

      const lineup = makeLineup();
      const totalW = lineup.reduce((s, h) => s + h.weight, 0);

      // --- Pantalla de apuesta: se ven los 8 caballos y sus cuotas ---
      const listEmbed = base(config.colors.primary)
        .setTitle('🏇 Próxima carrera — elige tu caballo')
        .setDescription(lineup.map((h) => `${h.tag} · **${h.name}** — cuota **${h.odds}/1**`).join('\n'))
        .addFields({ name: 'Tu apuesta', value: coins(wager), inline: true })
        .setFooter({ text: `${config.casino.name} • cuota alta = paga más pero gana menos` });

      const selectRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('horse')
          .setPlaceholder('🐎 Elige tu caballo')
          .addOptions(
            lineup.map((h, i) => ({
              label: `${h.name} (${h.odds}/1)`,
              value: String(i),
              emoji: TAGS[i],
              description: `~${((h.weight / totalW) * 100).toFixed(0)}% de ganar · paga x${h.odds + 1}`,
            }))
          )
      );
      await interaction.editReply({ embeds: [listEmbed], components: [selectRow] });

      // --- Esperar la elección ---
      let pick;
      try {
        const sel = await response.awaitMessageComponent({
          filter: (i) => i.user.id === userId && i.customId === 'horse',
          componentType: ComponentType.StringSelect,
          time: 60000,
        });
        pick = Number(sel.values[0]);
        await sel.deferUpdate().catch(() => {});
      } catch {
        await interaction
          .editReply({ embeds: [base(config.colors.dark).setTitle('🏇 Carrera cancelada').setDescription('No elegiste caballo a tiempo.')], components: [] })
          .catch(() => {});
        return false;
      }

      // --- La carrera ---
      placeBet(userId, wager);
      const oddsPick = lineup[pick].odds;
      const pos = lineup.map(() => 0);
      const winner = pickWinner(lineup);

      const renderTrack = (title, color, crownIdx = -1) => {
        const lanes = lineup.map((h, i) => {
          const p = Math.min(pos[i], TRACK);
          const ahead = '·'.repeat(Math.max(0, TRACK - p));
          const behind = '─'.repeat(p);
          const you = i === pick ? ' ⬅️' : '';
          const crown = i === crownIdx ? ' 👑' : '';
          return `${h.tag}🏁${ahead}${h.emoji}${behind}|${you}${crown}`;
        });
        return base(color)
          .setTitle(title)
          .setDescription('```\n' + lanes.join('\n') + '\n```')
          .addFields(
            { name: 'Tu caballo', value: `${lineup[pick].tag} · ${lineup[pick].name} (${oddsPick}/1)`, inline: true },
            { name: 'Apuesta', value: coins(wager), inline: true }
          );
      };

      await interaction.editReply({ embeds: [renderTrack('🏇 ¡Salen de la línea de salida!', config.colors.primary)], components: [] });
      await sleep(700);

      // El ganador va algo más rápido; los demás no cruzan la meta antes que él.
      while (true) {
        pos[winner] += Math.floor(Math.random() * 3) + 2; // 2-4
        for (let i = 0; i < lineup.length; i++) {
          if (i === winner) continue;
          pos[i] += Math.floor(Math.random() * 3) + 1; // 1-3
          pos[i] = Math.min(pos[i], TRACK - 1);
        }
        if (pos[winner] >= TRACK) {
          pos[winner] = TRACK;
          break;
        }
        await interaction.editReply({ embeds: [renderTrack('🏇 ¡Carrera en marcha!', config.colors.primary)], components: [] });
        await sleep(700);
      }

      const win = winner === pick;
      const profit = Math.round(wager * oddsPick);
      const net = win ? profit : -wager;
      payout(userId, win ? wager + profit : 0);
      recordResult(userId, { wagered: wager, net, game: 'carrera' });
      const bal = getUser(userId).balance;

      const resultEmbed = renderTrack(
        `🏆 Ganó ${lineup[winner].tag} · ${lineup[winner].name} (${lineup[winner].odds}/1)`,
        win ? config.colors.gold : config.colors.red,
        winner
      ).addFields(
        {
          name: win ? '🎉 Resultado' : '💀 Resultado',
          value: win
            ? `¡Tu caballo ganó! +${fmt(net)} ${config.currency.symbol} (${oddsPick}/1)`
            : `Tu caballo no llegó primero. -${fmt(wager)} ${config.currency.symbol}`,
          inline: false,
        },
        { name: 'Saldo', value: coins(bal), inline: true }
      );
      const againRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('again')
          .setEmoji('🔁')
          .setLabel(`Otra carrera · ${fmt(wager)} ${config.currency.symbol}`)
          .setStyle(ButtonStyle.Success)
          .setDisabled(bal < wager)
      );
      await interaction.editReply({ embeds: [resultEmbed], components: [againRow] });

      // --- Esperar "otra carrera" ---
      try {
        const b = await response.awaitMessageComponent({
          filter: (i) => i.user.id === userId && i.customId === 'again',
          componentType: ComponentType.Button,
          time: 60000,
        });
        await b.deferUpdate().catch(() => {});
        return true;
      } catch {
        await interaction.editReply({ components: [] }).catch(() => {});
        return false;
      }
    }

    let again = true;
    while (again) again = await playOne();
  },
};
