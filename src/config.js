// === Configuración central de Nova Casino ===
// Cambia aquí el nombre de la moneda, colores, límites y economía.
module.exports = {
  casino: {
    name: 'Nova Casino',
    tagline: 'Juega, apuesta y presume — todo con fichas ficticias.',
  },

  currency: {
    name: 'Nova',
    symbol: '💎',
    ticker: '◆',
  },

  economy: {
    startingBalance: 1000,   // saldo inicial de un usuario nuevo
    dailyAmount: 500,        // recompensa diaria base
    dailyStreakBonus: 100,   // bonus por cada día de racha
    dailyStreakMax: 10,      // tope de días de racha que dan bonus
    dailyCooldown: 22 * 60 * 60 * 1000,  // se puede reclamar cada 22h
    streakResetAfter: 48 * 60 * 60 * 1000, // si pasas de 48h pierdes la racha
    workMin: 75,
    workMax: 350,
    workCooldown: 30 * 60 * 1000, // 30 min
  },

  limits: {
    minBet: 10,
    maxBet: 250000,
  },

  // Anti-fraude: límites por usuario (ventana móvil de 1 hora). Los owners y
  // administradores están EXENTOS de todos estos límites.
  antifraud: {
    maxBetsPerHour: 100,       // máximo de apuestas por hora
    maxWonPerHour: 10000,      // máximo de monedas ganadas por hora (anti-explotación)
    newAccountMaxAgeHours: 24, // una cuenta de Discord con menos de esto es "nueva"
    newAccountMaxBet: 500,     // apuesta máxima para cuentas nuevas
  },

  // Jackpot progresivo de /slots: un bote común que crece con las tiradas de
  // TODA la gente y lo revienta quien saque 💎💎💎 en la línea central.
  jackpot: {
    seed: 1000,          // valor base al que se reinicia el bote tras ganarlo
    contribution: 0.01,  // % de cada apuesta de /slots que alimenta el bote (1%)

    // Canal fijo donde se muestra el bote EN VIVO (un mensaje que se
    // autoedita). Deja '' para desactivarlo. Rellena con el ID de un canal
    // (activa Modo desarrollador en Discord → clic derecho en el canal → Copiar ID).
    displayChannel: '1535475835710996571',
    boardRefreshMs: 60 * 1000, // cada cuánto se refresca el mensaje del bote

    // Anti cuentas falsas: para COBRAR el bote hay que cumplir al menos UNA
    // de estas dos condiciones. Si no, se alinean los 💎 pero el bote NO se
    // entrega ni se reinicia (sigue creciendo para jugadores legítimos).
    minAccountAgeDays: 7, // días de antigüedad de la cuenta de Discord
    minInvites: 3,        // o haber invitado a esta gente al servidor
    // Seguir las invitaciones requiere el intent privilegiado "Server Members"
    // (actívalo en el Discord Developer Portal). Con false solo cuenta la
    // antigüedad y el bot sigue funcionando sin intents privilegiados.
    trackInvites: false,
  },

  colors: {
    primary: 0x9b5de5, // morado Nova
    gold: 0xf5c518,
    green: 0x2ecc71,
    red: 0xe74c3c,
    dark: 0x1e1e2e,
    blurple: 0x5865f2,
  },

  // IDs de los "owners" del bot que pueden usar comandos de administración
  // (p. ej. /admin-saldo). El dueño del servidor SIEMPRE puede, esté o no aquí.
  owners: [],

  // Canal donde se registra cada partida (ID del canal de Discord).
  // Deja '' para desactivar el log. El bot debe poder escribir en ese canal.
  logChannel: '1524779532127699095',

  // Canal por defecto donde se publican los mercados de apuestas.
  // Al crear un mercado se puede indicar otro canal con la opción `canal`.
  betChannel: '1526682410773909535',

  // Lotería: se compran boletos para un bote común y hay un sorteo programado.
  lottery: {
    ticketPrice: 10, // coste de cada boleto
    houseCut: 0.1, // 10% del bote se queda la casa; el resto va al ganador
    drawIntervalMs: 24 * 60 * 60 * 1000, // sorteo cada 24 h
    minParticipants: 2, // con menos participantes se reembolsa (no se sortea)
    channel: '', // canal donde se anuncia el sorteo (vacío = sin anuncio)
  },

  // Copias de seguridad automáticas de la base de datos (data/casino.db).
  backup: {
    enabled: true,
    intervalHours: 6,   // cada cuántas horas se hace copia
    dir: 'backups',     // carpeta local donde se guardan (relativa a la raíz)
    keep: 12,           // cuántas copias locales conservar (se borran las más viejas)
    // Off-site (opcional): sube el .db a un canal de Discord y/o a tu servidor.
    channel: '',        // ID de canal de Discord donde subir el backup ('' = no)
    webhookUrl: '',     // o POST del archivo a esta URL/servidor externo ('' = no)
  },

  // Reporte diario del casino: un resumen que se publica cada día en un canal.
  dailyReport: {
    channel: '1535485799708098721', // ID del canal donde se publica ('' = desactivado)
    hour: 23,         // hora LOCAL del servidor a la que se publica (0-23)
    minute: 59,       // minuto (el reporte cubre el día que termina a esa hora)
    // "VIPs activos": usuarios activos ese día que tienen este rol de Discord.
    // Deja '' si no tienes sistema VIP (se mostrará 0).
    vipRole: '',
    // "Ingresos estimados (ventas)": convierte el BENEFICIO del servidor del día
    // a euros con esta tasa (cuántas monedas equivalen a 1 €). Con 100, un
    // beneficio de 124.700 monedas = 1.247 €.
    coinsPerEuro: 100,
  },

  // Rol obligatorio para poder jugar (ID del rol de Discord).
  // Si está vacío (''), cualquiera puede jugar. Si tiene un ID, solo quien
  // tenga ese rol podrá usar los juegos. El ID del rol tampoco cambia al
  // renombrarlo. (Afecta a los juegos listados en `channels`.)
  requiredRole: '1524582072042127520',

  // Canal donde se permite cada juego (ID del canal de Discord).
  // - Deja '' para permitir ese juego en cualquier canal.
  // - Puedes poner varios: ['id1', 'id2'].
  // - El ID no cambia aunque renombres o muevas el canal.
  channels: {
    slots: '1524477258889429042',
    ruleta: '1524477213804728432',
    blackjack: '1524477313893535814',
    poker: '1524477290803626137',
    mines: '1524477274152505477',
    hilo: '1524786887812845588',
    dados: '1524786845257564231',
    carrera: '1524573678942162998',
    cripto: '1524581206300295288',
    coinflip: '1524786859891363991',
    loteria: '1524786970793087016',
  },
};
