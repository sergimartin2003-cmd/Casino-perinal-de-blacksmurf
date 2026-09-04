// Sistema de referidos (viralidad). Todo ADITIVO y con fichas ficticias:
//  - Bono único al vincular (invitado + invitador).
//  - "Rake" pasivo: un % de lo que apuestan tus invitados (2 niveles).
//  - Hitos por nº de invitados (3/5/10) con recompensa reclamable.
// Se engancha al gameEvents que la economía YA emite (no toca ningún juego).
const db = require('../database/db');
const { gameEvents, addBalance, getUser } = require('./economy');

// Ajustes del sistema (edítalos aquí sin tocar nada más).
const CONFIG = {
  welcomeReferrer: 500, // bono único a quien invita
  welcomeReferee: 250, // bono único al invitado
  rakeL1: 0.05, // 5% de lo apostado por tu invitado directo (nivel 1)
  rakeL2: 0.02, // 2% de lo apostado por el invitado de tu invitado (nivel 2)
  minRake: 1, // no acreditar comisiones menores a esto
  maxRefereeWagered: 50000, // solo puedes "ser invitado" si eres jugador nuevo (has apostado menos de esto)
  milestones: [
    { count: 3, reward: 2000 },
    { count: 5, reward: 5000 },
    { count: 10, reward: 15000 },
  ],
};

// Tablas propias (autocreadas). No tocan ninguna tabla existente.
db.exec(`CREATE TABLE IF NOT EXISTS referrals (
  user_id     TEXT PRIMARY KEY,   -- el invitado
  referrer_id TEXT NOT NULL,      -- quien lo invitó
  created_at  INTEGER NOT NULL
)`);
db.exec(`CREATE TABLE IF NOT EXISTS referral_earnings (
  referrer_id TEXT PRIMARY KEY,
  earned      INTEGER NOT NULL DEFAULT 0   -- total acumulado (bonos + rake + hitos)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS referral_milestone_claims (
  user_id    TEXT NOT NULL,
  milestone  INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, milestone)
)`);

const getRefStmt = db.prepare('SELECT referrer_id FROM referrals WHERE user_id = ?');
const setRefStmt = db.prepare('INSERT OR IGNORE INTO referrals (user_id, referrer_id, created_at) VALUES (?, ?, ?)');
const countInvitedStmt = db.prepare('SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?');
const invitedListStmt = db.prepare('SELECT user_id, created_at FROM referrals WHERE referrer_id = ? ORDER BY created_at DESC LIMIT 15');
const addEarnStmt = db.prepare(
  'INSERT INTO referral_earnings (referrer_id, earned) VALUES (?, ?) ON CONFLICT(referrer_id) DO UPDATE SET earned = earned + excluded.earned'
);
const getEarnStmt = db.prepare('SELECT earned FROM referral_earnings WHERE referrer_id = ?');
const milestoneClaimsStmt = db.prepare('SELECT milestone FROM referral_milestone_claims WHERE user_id = ?');
const insertMilestoneStmt = db.prepare('INSERT OR IGNORE INTO referral_milestone_claims (user_id, milestone, claimed_at) VALUES (?, ?, ?)');

const referrerOf = (userId) => getRefStmt.get(userId)?.referrer_id || null;
const invitedCount = (userId) => countInvitedStmt.get(userId).n;
const earnedBy = (userId) => getEarnStmt.get(userId)?.earned || 0;
const invitedList = (userId) => invitedListStmt.all(userId);

/**
 * Vincula un invitado con su invitador (una sola vez). Paga los bonos de bienvenida.
 * @returns {{ok:true, referrerBonus:number, refereeBonus:number} | {error:string}}
 */
function link(refereeId, referrerId) {
  if (referrerId === refereeId) return { error: 'No puedes invitarte a ti mismo. 🙃' };
  if (referrerOf(refereeId)) return { error: 'Ya registraste quién te invitó (solo se puede una vez).' };
  if (referrerOf(referrerId) === refereeId) return { error: 'No puedes poner como invitador a alguien que invitaste tú.' };
  if (getUser(refereeId).total_wagered >= CONFIG.maxRefereeWagered) {
    return { error: 'El código de invitado es solo para jugadores nuevos (ya has jugado demasiado 😉).' };
  }

  const ok = db.transaction(() => {
    if (setRefStmt.run(refereeId, referrerId, Date.now()).changes === 0) return false; // carrera
    getUser(referrerId);
    addBalance(refereeId, CONFIG.welcomeReferee);
    addBalance(referrerId, CONFIG.welcomeReferrer);
    addEarnStmt.run(referrerId, CONFIG.welcomeReferrer);
    return true;
  })();

  if (!ok) return { error: 'No se pudo registrar (quizá ya tenías invitador).' };
  return { ok: true, referrerBonus: CONFIG.welcomeReferrer, refereeBonus: CONFIG.welcomeReferee };
}

/** Estado de los hitos de un usuario (alcanzado / reclamado). */
function milestoneStatus(userId) {
  const invited = invitedCount(userId);
  const claimed = new Set(milestoneClaimsStmt.all(userId).map((r) => r.milestone));
  return CONFIG.milestones.map((m) => ({ ...m, reached: invited >= m.count, claimed: claimed.has(m.count) }));
}

/** Reclama los hitos alcanzados y no reclamados. Atómico e idempotente. */
function claimMilestones(userId) {
  const claimable = milestoneStatus(userId).filter((m) => m.reached && !m.claimed);
  if (!claimable.length) return { got: 0 };
  getUser(userId);
  const got = db.transaction(() => {
    let sum = 0;
    for (const m of claimable) {
      if (insertMilestoneStmt.run(userId, m.count, Date.now()).changes > 0) sum += m.reward;
    }
    if (sum > 0) {
      addBalance(userId, sum);
      addEarnStmt.run(userId, sum);
    }
    return sum;
  })();
  return { got };
}

// Rake: en cada partida se paga comisión a los invitadores (2 niveles). Se engancha
// al cargar el módulo (lo carga el comando /invitar o /referido al arrancar el bot).
let rakeAttached = false;
function attachRake() {
  if (rakeAttached) return;
  rakeAttached = true;
  gameEvents.on('result', (ev) => {
    try {
      const wagered = Math.max(0, Math.round(ev?.wagered || 0));
      if (wagered <= 0) return;
      const l1 = referrerOf(ev.userId);
      if (!l1) return;
      const c1 = Math.floor(wagered * CONFIG.rakeL1);
      if (c1 >= CONFIG.minRake) {
        addBalance(l1, c1);
        addEarnStmt.run(l1, c1);
      }
      const l2 = referrerOf(l1);
      if (!l2) return;
      const c2 = Math.floor(wagered * CONFIG.rakeL2);
      if (c2 >= CONFIG.minRake) {
        addBalance(l2, c2);
        addEarnStmt.run(l2, c2);
      }
    } catch {
      // Nunca romper una partida por un fallo del rake.
    }
  });
}
attachRake();

module.exports = {
  CONFIG,
  link,
  claimMilestones,
  milestoneStatus,
  referrerOf,
  invitedCount,
  earnedBy,
  invitedList,
};
