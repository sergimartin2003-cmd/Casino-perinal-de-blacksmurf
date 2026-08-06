// Utilidades de baraja compartidas por blackjack y video poker.

const SUITS = [
  { s: '♠', red: false },
  { s: '♥', red: true },
  { s: '♦', red: true },
  { s: '♣', red: false },
];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK_VALUE = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

/** Baraja de 52 cartas ya mezclada (Fisher-Yates). */
function newDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/** Valor de una carta para blackjack (A = 11, figuras = 10). */
function cardBJ(card) {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

/** Mejor total de una mano de blackjack, ajustando ases. */
function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    total += cardBJ(c);
    if (c.rank === 'A') aces++;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return total;
}

function renderCard(card) {
  return `\`${card.rank}${card.suit.s}\``;
}

/** Carta grande en "arte ASCII" (bloque de código) para mostrarla como una carta. */
function renderCardBig(card) {
  const s = card.suit.s;
  const top = card.rank.padEnd(2); // "7 ", "10", "A "
  const bot = card.rank.padStart(2); // " 7", "10", " A"
  return [
    '```',
    '┌───────┐',
    `│${top}     │`,
    '│       │',
    `│   ${s}   │`,
    '│       │',
    `│     ${bot}│`,
    '└───────┘',
    '```',
  ].join('\n');
}

function renderHand(hand) {
  return hand.map(renderCard).join(' ');
}

module.exports = { SUITS, RANKS, RANK_VALUE, newDeck, cardBJ, handValue, renderCard, renderCardBig, renderHand };
