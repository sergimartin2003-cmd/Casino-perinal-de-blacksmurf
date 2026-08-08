require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  Collection,
  GatewayIntentBits,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const config = require('./config');
const { startResolver } = require('./lib/cryptoRounds');
const gamelog = require('./lib/gamelog');
const lottery = require('./lib/lottery');
const markets = require('./lib/markets');
const espn = require('./lib/espn');
const jackpotBoard = require('./lib/jackpotBoard');
const invites = require('./lib/invites');
const dailyReport = require('./lib/dailyReport');
const antifraud = require('./lib/antifraud');
const backup = require('./lib/backup');
const { isOwner } = require('./lib/owner');
const { resolveBet } = require('./lib/bet');
const { getUser } = require('./lib/economy');
const { fmt } = require('./lib/format');

// Intents mínimos por defecto (sin privilegiados). El seguimiento de
// invitaciones del jackpot exige GuildMembers (privilegiado) + GuildInvites;
// solo se piden si se activa en config para no romper el arranque del bot.
const intents = [GatewayIntentBits.Guilds];
if (config.jackpot.trackInvites) {
  intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites);
}

const client = new Client({ intents });
client.commands = new Collection();

// Carga dinámica de todos los comandos de /commands
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  if (command.data && command.execute) {
    client.commands.set(command.data.name, command);
  } else {
    console.warn(`⚠️  El comando ${file} no exporta { data, execute }.`);
  }
}

/** ¿El miembro tiene ese rol? Soporta GuildMember (roles.cache) y payload crudo (array). */
function memberHasRole(member, roleId) {
  if (!member) return false;
  const roles = member.roles;
  if (roles?.cache) return roles.cache.has(roleId);
  if (Array.isArray(roles)) return roles.includes(roleId);
  return false;
}

// --- Apuestas deportivas a golpe de clic ---
async function handleBetButton(interaction) {
  const [, marketId, optIdx] = interaction.customId.split(':');
  const market = markets.getMarket(Number(marketId));
  if (!market || market.status !== 'open') {
    return interaction.reply({ content: '❌ Este mercado ya no admite apuestas.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  if (config.requiredRole && !memberHasRole(interaction.member, config.requiredRole)) {
    return interaction.reply({ content: `❌ Necesitas el rol <@&${config.requiredRole}> para apostar.`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const opt = markets.optionsOf(market)[Number(optIdx)];
  if (!opt) return interaction.reply({ content: '❌ Opción no válida.', flags: MessageFlags.Ephemeral }).catch(() => {});

  const modal = new ModalBuilder().setCustomId(`betmodal:${marketId}:${optIdx}`).setTitle(`Apostar: ${opt.name}`.slice(0, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel(`Cantidad (cuota ${opt.odds})`.slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(15)
        .setPlaceholder('Ej: 500, all, half')
    )
  );
  return interaction.showModal(modal).catch(() => {});
}

async function handleBetModal(interaction) {
  const [, marketId, optIdx] = interaction.customId.split(':');
  const r = resolveBet(interaction.fields.getTextInputValue('amount'), getUser(interaction.user.id).balance);
  if (r.error) return interaction.reply({ content: `❌ ${r.error}`, flags: MessageFlags.Ephemeral }).catch(() => {});
  const res = markets.placeMarketBet(Number(marketId), interaction.user.id, Number(optIdx), r.amount);
  if (res.error) return interaction.reply({ content: `❌ ${res.error}`, flags: MessageFlags.Ephemeral }).catch(() => {});

  const bal = getUser(interaction.user.id).balance;
  await interaction
    .reply({
      content: `✅ Apostaste **${fmt(r.amount)}** ${config.currency.symbol} a **${res.option.name}** @${res.option.odds}. Si aciertas cobras **${fmt(res.potential)}** ${config.currency.symbol}. Saldo: ${fmt(bal)}.`,
      flags: MessageFlags.Ephemeral,
    })
    .catch(() => {});
  await markets.updateBoard(interaction.client, markets.getMarket(Number(marketId)));
}

// --- Crear mercado de un evento real: elegir enfrentamiento -> pedir cuotas ---
async function handleMatchPick(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: '❌ Solo los owners abren mercados.', flags: MessageFlags.Ephemeral }).catch(() => {});
  const [, leagueKey, eventId, channelId] = interaction.customId.split(':');
  const f = (await espn.fetchFixtures(leagueKey)).find((x) => String(x.id) === String(eventId));
  const home = f?.home || 'Local / A';
  const away = f?.away || 'Visitante / B';
  const draw = espn.hasDraw(leagueKey);

  const modal = new ModalBuilder().setCustomId(`matchodds:${leagueKey}:${eventId}:${channelId}`).setTitle('Cuotas del evento');
  const rows = [
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('o1').setLabel(`Cuota: ${home}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 2.1')
    ),
  ];
  if (draw) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('ox').setLabel('Cuota: Empate').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 3.3')
      )
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('o2').setLabel(`Cuota: ${away}`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('Ej: 3.4')
    )
  );
  modal.addComponents(...rows);
  return interaction.showModal(modal).catch(() => {});
}

async function handleMatchOdds(interaction) {
  if (!isOwner(interaction)) return interaction.reply({ content: '❌ Solo los owners abren mercados.', flags: MessageFlags.Ephemeral }).catch(() => {});
  const [, leagueKey, eventId, channelId] = interaction.customId.split(':');
  const draw = espn.hasDraw(leagueKey);
  const parse = (v) => {
    const n = parseFloat(String(v).replace(',', '.'));
    return n >= 1.01 && n <= 1000 ? n : null;
  };
  const o1 = parse(interaction.fields.getTextInputValue('o1'));
  const o2 = parse(interaction.fields.getTextInputValue('o2'));
  const ox = draw ? parse(interaction.fields.getTextInputValue('ox')) : null;
  if (o1 == null || o2 == null || (draw && ox == null)) {
    return interaction.reply({ content: '❌ Cuotas no válidas (deben estar entre 1.01 y 1000).', flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  const f = (await espn.fetchFixtures(leagueKey)).find((x) => String(x.id) === String(eventId));
  if (!f) return interaction.reply({ content: '❌ Ese enfrentamiento ya no está disponible (habrá empezado). Elige otro.', flags: MessageFlags.Ephemeral }).catch(() => {});

  const boardChannelId = channelId || config.betChannel || interaction.channelId;
  const id = markets.createMatchMarket({
    leagueKey,
    eventId,
    eventDate: f.date,
    homeName: f.home,
    awayName: f.away,
    odds: draw ? [o1, ox, o2] : [o1, o2],
    channelId: boardChannelId,
    userId: interaction.user.id,
  });
  const r = await markets.publishBoard(interaction.client, markets.getMarket(id));
  return interaction.reply({
    content: r.ok
      ? `✅ Mercado del partido abierto en <#${boardChannelId}>. La gente ya puede apostar **pulsando los botones**.`
      : `⚠️ Mercado creado, pero **no pude publicar el tablero** en <#${boardChannelId}>.\nMotivo: \`${r.error}\`\nRevisa que el bot tenga en ese canal: **Ver canal**, **Enviar mensajes** e **Insertar enlaces**.`,
    flags: MessageFlags.Ephemeral,
  });
}

client.once(Events.ClientReady, (c) => {
  console.log(`✅ ${c.user.tag} conectado — ${config.casino.name} abierto.`);
  c.user.setActivity(`${config.casino.name} 🎰 /help`, { type: 0 });
  startResolver(c); // liquida las apuestas de /cripto cuando cierra su ventana
  gamelog.attach(c); // registra cada partida en el canal de log
  lottery.startScheduler(c); // sortea la lotería cuando vence su temporizador
  markets.startMatchResolver(c); // resuelve solo los mercados de partidos reales
  jackpotBoard.start(c); // muestra el bote en vivo en el canal fijo configurado
  invites.attach(c); // rastrea invitaciones (si trackInvites está activado)
  invites.init(c); // cachea las invitaciones actuales de cada servidor
  dailyReport.attach(); // acumula estadísticas por día de cada partida
  dailyReport.startScheduler(c); // publica el reporte diario en el canal configurado
  antifraud.attach(); // registra apuestas/ganancias por hora para los límites anti-fraude
  backup.startScheduler(c); // copias de seguridad automáticas de la base de datos
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Autocompletado de ligas para /mercado partido.
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'mercado') {
      const focused = interaction.options.getFocused(true);
      if (focused.name === 'liga') return interaction.respond(espn.searchLeagues(focused.value)).catch(() => {});
    }
    return interaction.respond([]).catch(() => {});
  }

  // Apuestas deportivas: botón de opción → ventana de cantidad → apuesta.
  if (interaction.isButton() && interaction.customId.startsWith('bet:')) return handleBetButton(interaction);
  if (interaction.isButton() && interaction.customId.startsWith('matchpick:')) return handleMatchPick(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith('betmodal:')) return handleBetModal(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith('matchodds:')) return handleMatchOdds(interaction);

  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const isGame = Object.prototype.hasOwnProperty.call(config.channels ?? {}, interaction.commandName);
  const isStaff = isOwner(interaction) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

  // Rol "jugador" obligatorio para usar CUALQUIER comando del bot (salvo admins/owners).
  if (config.requiredRole && !isStaff) {
    if (!interaction.inGuild()) {
      return interaction
        .reply({ content: '❌ Este bot solo se puede usar dentro del servidor.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    if (!memberHasRole(interaction.member, config.requiredRole)) {
      return interaction
        .reply({
          content: `❌ Necesitas el rol <@&${config.requiredRole}> para usar el bot. Pídeselo a un administrador.`,
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
    }
  }

  // Restricción de canal por juego: cada juego solo en su canal.
  const allowedRaw = config.channels?.[interaction.commandName];
  const allowedList = (Array.isArray(allowedRaw) ? allowedRaw : [allowedRaw]).filter(Boolean);
  if (allowedList.length && !allowedList.includes(interaction.channelId)) {
    const where = allowedList.map((id) => `<#${id}>`).join(' o ');
    return interaction
      .reply({
        content: `❌ **/${interaction.commandName}** solo se puede jugar en ${where}.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`Error en /${interaction.commandName}:`, err);
    const payload = {
      content: '❌ Algo salió mal en la mesa. Inténtalo de nuevo.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
