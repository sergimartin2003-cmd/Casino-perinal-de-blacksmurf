require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Events, MessageFlags } = require('discord.js');

const config = require('./config');
// Aplica los ajustes guardados con /config SOBRE config antes de cargar nada más.
require('./lib/settings').load();
const { startResolver } = require('./lib/cryptoRounds');
const gamelog = require('./lib/gamelog');
const lottery = require('./lib/lottery');
const jackpotBoard = require('./lib/jackpotBoard');
const invites = require('./lib/invites');
const dailyReport = require('./lib/dailyReport');
const antifraud = require('./lib/antifraud');
const backup = require('./lib/backup');
const SportsUpdater = require('./sportsUpdater');
const SportsCleanup = require('./sportsCleanup');
const sportsBoard = require('./sportsBoard');
const health = require('./lib/health');
const { isStaff } = require('./lib/owner');

const ODDS_API_KEY = process.env.ODDS_API_KEY;

// Intents mínimos por defecto (sin privilegiados). El seguimiento de
// invitaciones del jackpot exige GuildMembers (privilegiado) + GuildInvites;
// solo se piden si se activa en config para no romper el arranque del bot.
const intents = [GatewayIntentBits.Guilds];
if (config.jackpot.trackInvites) {
  intents.push(GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites);
}

const client = new Client({ intents });
client.commands = new Collection();

// Recopila archivos .js de comandos de forma recursiva (para subcarpetas como commands/sports/).
function collectCommandFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectCommandFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Carga dinámica de comandos: src/commands/ (casino) y commands/ (apuestas deportivas), recursivo.
const commandDirs = [path.join(__dirname, 'commands'), path.join(__dirname, '..', 'commands')];
for (const dir of commandDirs) {
  for (const file of collectCommandFiles(dir)) {
    const command = require(file);
    if (command.data && command.execute) {
      client.commands.set(command.data.name, command);
    } else {
      console.warn(`⚠️  El comando ${file} no exporta { data, execute }.`);
    }
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

client.once(Events.ClientReady, (c) => {
  console.log(`✅ ${c.user.tag} conectado — ${config.casino.name} abierto.`);
  c.user.setActivity(`${config.casino.name} 🎰 /help`, { type: 0 });
  startResolver(c); // liquida las apuestas de /cripto cuando cierra su ventana
  gamelog.attach(c); // registra cada partida en el canal de log
  lottery.startScheduler(c); // sortea la lotería cuando vence su temporizador
  jackpotBoard.start(c); // muestra el bote en vivo en el canal fijo configurado
  invites.attach(c); // rastrea invitaciones (si trackInvites está activado)
  invites.init(c); // cachea las invitaciones actuales de cada servidor
  dailyReport.attach(); // acumula estadísticas por día de cada partida
  dailyReport.startScheduler(c); // publica el reporte diario en el canal configurado
  antifraud.attach(); // registra apuestas/ganancias por hora para los límites anti-fraude
  backup.startScheduler(c); // copias de seguridad automáticas de la base de datos

  // Sistema de apuestas deportivas (solo si hay clave de la Odds API).
  if (ODDS_API_KEY) {
    console.log('📊 Inicializando sistema de apuestas deportivas…');
    const updater = new SportsUpdater(ODDS_API_KEY, './data/casino.db');
    updater.scheduleUpdates(15); // actualiza eventos/cuotas/resultados cada 15 min
    const sportsCleanup = new SportsCleanup('./data/casino.db', null);
    sportsCleanup.scheduleCleanup(6); // limpia eventos antiguos cada 6 h
    console.log('✅ Sistema de apuestas deportivas inicializado.');
  } else {
    console.log('⚠️  ODDS_API_KEY no configurada. Apuestas deportivas desactivadas.');
  }
  sportsBoard.start(c); // panel clickable de apuestas deportivas en su canal
});

client.on(Events.InteractionCreate, async (interaction) => {
  // Panel de apuestas deportivas: botón de opción → ventana de cantidad → apuesta.
  if (interaction.isButton() && interaction.customId.startsWith('sbet:')) return sportsBoard.handleBetButton(interaction);
  if (interaction.isButton() && interaction.customId.startsWith('sbetmine:')) return sportsBoard.handleMyBets(interaction);
  if (interaction.isModalSubmit() && interaction.customId.startsWith('sbetamt:')) return sportsBoard.handleBetModal(interaction);

  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  const isGame = Object.prototype.hasOwnProperty.call(config.channels ?? {}, interaction.commandName);
  const staff = isStaff(interaction);

  // Rol "jugador" obligatorio para usar CUALQUIER comando del bot (salvo admins/owners).
  if (config.requiredRole && !staff) {
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

  // Rol obligatorio POR JUEGO (además del global), salvo admins/owners.
  const gameRole = config.gameRoles?.[interaction.commandName];
  if (gameRole && !staff && !memberHasRole(interaction.member, gameRole)) {
    return interaction
      .reply({
        content: `❌ Para **/${interaction.commandName}** necesitas el rol <@&${gameRole}>.`,
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

// Red de seguridad: un error transitorio (interacción caducada a los 15 min, hipo
// de la API de Discord, una promesa suelta en un colector) NO debe tumbar el bot.
// Se registra y se sigue; con las operaciones de dinero ya transaccionales, seguir
// vivo es seguro. Un fallo real y repetido se verá en el log.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason instanceof Error ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err instanceof Error ? err.stack : err);
});
client.on(Events.Error, (err) => console.error('[client error]', err?.message ?? err));
client.on(Events.ShardError, (err) => console.error('[shard error]', err?.message ?? err));

// Puerto de salud para plataformas tipo "Web Service" (p. ej. Render): si hay
// PORT, se escucha ahí para que el deploy se considere sano. En local no hace nada.
health.start(() => ({
  bot: client.user ? client.user.tag : 'arrancando',
  uptime: Math.floor(process.uptime()),
}));

if (!process.env.DISCORD_TOKEN) {
  console.error('❌ Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
