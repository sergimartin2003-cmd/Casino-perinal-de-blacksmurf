// Seguimiento de invitaciones para el gate anti cuentas falsas del jackpot.
// OPT-IN: solo funciona con config.jackpot.trackInvites = true, que además
// exige el intent privilegiado GuildMembers (activarlo en el Developer Portal).
// Estrategia: se cachean los usos de cada invitación; al entrar un miembro se
// compara para saber qué invitación creció y así acreditar a quien invitó.
const config = require('../config');
const { addInvite } = require('./economy');

// guildId -> Map(codigoInvitacion -> usos)
const cache = new Map();

async function snapshot(guild) {
  const invites = await guild.invites.fetch();
  return new Map(invites.map((i) => [i.code, i.uses ?? 0]));
}

async function cacheGuild(guild) {
  try {
    cache.set(guild.id, await snapshot(guild));
  } catch {
    // Sin permiso "Gestionar servidor": no podemos leer invitaciones.
  }
}

/** Registra los listeners de invitaciones. Llamar una vez en ClientReady. */
function attach(client) {
  if (!config.jackpot.trackInvites) return;

  client.on('guildCreate', cacheGuild);
  client.on('inviteCreate', (inv) => {
    const g = cache.get(inv.guild?.id) ?? new Map();
    g.set(inv.code, inv.uses ?? 0);
    if (inv.guild) cache.set(inv.guild.id, g);
  });
  client.on('inviteDelete', (inv) => cache.get(inv.guild?.id)?.delete(inv.code));

  client.on('guildMemberAdd', async (member) => {
    try {
      const before = cache.get(member.guild.id) ?? new Map();
      const current = await snapshot(member.guild);
      cache.set(member.guild.id, current);

      let inviterId = null;
      for (const [code, uses] of current) {
        if (uses > (before.get(code) ?? 0)) {
          const inv = await member.guild.invites.fetch(code).catch(() => null);
          inviterId = inv?.inviterId ?? inv?.inviter?.id ?? null;
          break;
        }
      }
      // No se acredita autoinvitarse.
      if (inviterId && inviterId !== member.id) addInvite(inviterId);
    } catch {
      // Fallo puntual leyendo invitaciones: no rompemos nada.
    }
  });
}

/** Cachea las invitaciones de los servidores ya conocidos. Llamar en ready. */
async function init(client) {
  if (!config.jackpot.trackInvites) return;
  for (const guild of client.guilds.cache.values()) {
    await cacheGuild(guild);
  }
}

module.exports = { attach, init };
