// Reporte diario del casino: acumula estadísticas por día escuchando los
// resultados de las partidas y publica un resumen en un canal a una hora fija.
const db = require('../database/db');
const { gameEvents, getJackpot } = require('./economy');
const { fmt } = require('./format');
const config = require('../config');

const DR = () => config.dailyReport;
const DIVIDER = '─────────────────────────────';

// --- Claves de día en hora LOCAL del servidor ---
function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function dayLabel(key) {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

// --- Acumulación de estadísticas ---
const upsertStatsStmt = db.prepare(`
  INSERT INTO daily_stats (day, bets, wagered, returned) VALUES (@day, 1, @wagered, @returned)
  ON CONFLICT(day) DO UPDATE SET
    bets     = bets + 1,
    wagered  = wagered + excluded.wagered,
    returned = returned + excluded.returned
`);
const upsertActiveStmt = db.prepare(`
  INSERT INTO daily_active (day, user_id, wagered, bets) VALUES (@day, @user_id, @wagered, 1)
  ON CONFLICT(day, user_id) DO UPDATE SET
    wagered = wagered + excluded.wagered,
    bets    = bets + 1
`);

/** Suma una partida a las estadísticas del día (returned = apuesta + neto). */
function record(r) {
  const day = dayKey();
  const wagered = Math.max(0, Math.round(r.wagered));
  const returned = Math.max(0, Math.round(r.wagered + r.net));
  upsertStatsStmt.run({ day, wagered, returned });
  upsertActiveStmt.run({ day, user_id: r.userId, wagered });
}

// --- Consultas del día ---
const getStatsStmt = db.prepare('SELECT * FROM daily_stats WHERE day = ?');
const activeCountStmt = db.prepare('SELECT COUNT(*) AS n FROM daily_active WHERE day = ?');
const activeIdsStmt = db.prepare('SELECT user_id FROM daily_active WHERE day = ?');
const topBettorStmt = db.prepare(
  'SELECT user_id, wagered FROM daily_active WHERE day = ? ORDER BY wagered DESC, bets DESC LIMIT 1'
);
const markReportedStmt = db.prepare('UPDATE daily_stats SET reported = 1 WHERE day = ?');

/** Cuenta cuántos usuarios activos del día tienen el rol VIP configurado. */
async function countActiveVips(guild, day) {
  const roleId = DR().vipRole;
  if (!roleId || !guild) return 0;
  let count = 0;
  for (const { user_id } of activeIdsStmt.all(day)) {
    try {
      const member = await guild.members.fetch(user_id);
      if (member.roles.cache.has(roleId)) count++;
    } catch {
      // El usuario ya no está en el servidor o no se pudo leer: no cuenta.
    }
  }
  return count;
}

/** Construye el texto del reporte para un día. `vips` se pasa ya calculado. */
function buildReport(day, vips = 0) {
  const s = getStatsStmt.get(day) || { bets: 0, wagered: 0, returned: 0 };
  const activos = activeCountStmt.get(day).n;
  const top = topBettorStmt.get(day);
  const beneficio = s.wagered - s.returned;
  const pct = s.wagered > 0 ? (beneficio / s.wagered) * 100 : 0;
  const ingresos = Math.round(vips * DR().revenuePerVip);
  const topLine = top ? `<@${top.user_id}> (${fmt(top.wagered)} monedas)` : '—';

  return [
    `📊 **REPORTE DEL DÍA ${dayLabel(day)}**`,
    DIVIDER,
    `Usuarios activos: ${fmt(activos)}`,
    `Apuestas totales: ${fmt(s.bets)}`,
    `Monedas apostadas: ${fmt(s.wagered)}`,
    `Monedas ganadas: ${fmt(s.returned)}`,
    `Beneficio del servidor: ${fmt(beneficio)} monedas (${pct.toFixed(1)}%)`,
    `Top apostador: ${topLine}`,
    `Jackpot actual: ${fmt(getJackpot())} monedas`,
    `VIPs activos: ${fmt(vips)}`,
    `Ingresos estimados (ventas): $${fmt(ingresos)}`,
  ].join('\n');
}

/** Genera el texto del reporte de un día, calculando los VIPs en ese servidor. */
async function generate(guild, day = dayKey()) {
  const vips = await countActiveVips(guild, day);
  return buildReport(day, vips);
}

/**
 * Publica el reporte de un día en el canal configurado.
 * @param {boolean} force  publica aunque no haya habido actividad / ya se reportó.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function postReport(client, day, { force = false } = {}) {
  const channelId = DR().channel;
  if (!channelId) return { ok: false, reason: 'sin_canal' };

  const stats = getStatsStmt.get(day);
  if (!force && (!stats || stats.reported)) {
    return { ok: false, reason: !stats ? 'sin_actividad' : 'ya_reportado' };
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return { ok: false, reason: 'canal_no_valido' };

  const text = await generate(channel.guild, day);
  await channel.send({ content: text, allowedMentions: { parse: [] } });
  markReportedStmt.run(day);
  return { ok: true };
}

// --- Planificador ---
const getNextStmt = db.prepare('SELECT next_report FROM daily_report_state WHERE id = 1');
const initNextStmt = db.prepare('INSERT INTO daily_report_state (id, next_report) VALUES (1, ?)');
const setNextStmt = db.prepare('UPDATE daily_report_state SET next_report = ? WHERE id = 1');

/** Próxima hora de reporte (hora:minuto locales) posterior a `from`. */
function nextReportAt(from = new Date()) {
  const d = new Date(from);
  d.setHours(DR().hour, DR().minute, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function getNextReport() {
  const row = getNextStmt.get();
  if (!row) {
    const t = nextReportAt();
    initNextStmt.run(t);
    return t;
  }
  return row.next_report;
}

/** Escucha los resultados de las partidas para acumular estadísticas. */
function attach() {
  gameEvents.on('result', (r) => {
    try {
      record(r);
    } catch (err) {
      console.error('Error acumulando estadística diaria:', err);
    }
  });
}

/** Arranca el planificador del reporte diario (llamar en ClientReady). */
function startScheduler(client) {
  if (!DR().channel) return; // reporte desactivado
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      let next = getNextReport();
      while (Date.now() >= next) {
        // El reporte cubre el día que acaba de terminar en `next`.
        const day = dayKey(new Date(next - 1000));
        await postReport(client, day);
        next = nextReportAt(new Date(next + 60000));
        setNextStmt.run(next);
      }
    } catch (err) {
      console.error('Error en el reporte diario:', err);
    } finally {
      running = false;
    }
  };
  tick(); // por si venció mientras el bot estaba apagado
  setInterval(tick, 30000);
}

module.exports = { attach, startScheduler, postReport, generate, buildReport, record, dayKey };
