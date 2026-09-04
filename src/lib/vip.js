// Rangos VIP por volumen apostado (total_wagered de toda la vida). Es puramente
// de ESTATUS: no cambia ninguna mecánica de juego, solo un distintivo/progreso.
// Los umbrales se pueden ajustar aquí sin tocar nada más.
const TIERS = [
  { key: 'bronce', name: 'Bronce', emoji: '🥉', min: 0, color: 0xcd7f32 },
  { key: 'plata', name: 'Plata', emoji: '🥈', min: 50000, color: 0xb9c2cc },
  { key: 'oro', name: 'Oro', emoji: '🥇', min: 250000, color: 0xf5c518 },
  { key: 'platino', name: 'Platino', emoji: '💠', min: 1000000, color: 0x69d1e8 },
  { key: 'diamante', name: 'Diamante', emoji: '💎', min: 5000000, color: 0x9b5de5 },
];

/** Devuelve el rango actual, el índice y el siguiente (o null si es el máximo). */
function tierOf(totalWagered) {
  const w = Math.max(0, Math.round(totalWagered || 0));
  let index = 0;
  for (let i = 0; i < TIERS.length; i++) if (w >= TIERS[i].min) index = i;
  return { tier: TIERS[index], index, next: TIERS[index + 1] || null, wagered: w };
}

/** Distintivo corto (emoji) del rango de un usuario, para adornar listados. */
function badge(totalWagered) {
  return tierOf(totalWagered).tier.emoji;
}

module.exports = { TIERS, tierOf, badge };
