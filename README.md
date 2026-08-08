# 🎰 Nova Casino — Bot de casino para Discord

Bot de casino para Discord con **economía de moneda ficticia** (💎 **Nova**). Sin dinero real, solo diversión: tragaperras, ruleta, blackjack, video póker, mines, predicción de cripto y más.

> Todo el saldo es virtual. No hay compras ni dinero real de por medio.

## ✨ Juegos y comandos

**Economía**
- `/balance` — saldo y estadísticas
- `/daily` — recompensa diaria con sistema de racha 🔥
- `/give` — transfiere Novas a otro usuario
- `/leaderboard` — ranking de más ricos

**Juegos**
- `/slots` 🎰 — tragaperras de 3 líneas con **comodín** 🃏 y **jackpot progresivo** 🏆 (RTP ≈ 95%). Un **1% de cada tirada** de todo el mundo alimenta un **bote común**; quien saque 💎💎💎 en la línea central se lo lleva entero, se anuncia en el canal de log y el bote se reinicia a un valor base (**1.000** por defecto). **Anti cuentas falsas:** para *cobrar* el bote hay que tener cierta antigüedad de cuenta **o** haber invitado a suficiente gente (ver abajo).
- `/jackpot` 🏆 — consulta el **bote progresivo** actual sin tener que jugar: cuánto hay acumulado, cuánto aporta cada tirada, el requisito para cobrarlo y quién fue el último en reventarlo
- `/ruleta` 🎡 — ruleta europea con **mesa interactiva**: coloca varias apuestas a la vez (rojo/negro, par/impar, docenas, columnas y número exacto), ajusta el valor de la ficha y gira, como en un casino real
- `/blackjack` 🃏 — 21 contra la banca con **Pedir / Plantarse / Doblar / Dividir / Seguro**
- `/poker` 🎴 — video póker *Jacks or Better* (retén cartas y cambia el resto)
- `/mines` 💣 — destapa gemas, esquiva minas y retírate a tiempo
- `/hilo` 🔼🔽 — ¿mayor o menor? Encadena aciertos y retírate (multiplicador según probabilidad real)
- `/dados` 🎲 — predice si la suma de dos dados será menor, igual o mayor que 7
- `/carrera` 🏇 — carrera estilo **GTA V (Inside Track)**: **8 caballos que cambian cada carrera** (con los **nombres del GTA traducidos al español** + cuotas de 3/1 a 18/1). Eliges tu caballo en un menú viendo las cuotas; los favoritos ganan más a menudo pero pagan menos (ventaja de la casa uniforme ~10%)
- `/cripto` 📈 — predice si una cripto **subirá o bajará en una ventana de tiempo real** (30s, 1m, 5m, 15m, 30m o 1h). Se compara el precio real de CoinGecko al abrir y al cerrar; el resultado se publica en el canal cuando vence la ventana (aunque el bot se reinicie, la apuesta se resuelve igual)
- `/coinflip` 🪙 — cara o cruz, doble o nada
- `/loteria` 🎟️ — compra boletos para un **bote común**; sorteo programado con ganador **ponderado por boletos** (la casa se queda un %). Subcomandos: `comprar`, `bote` y `sortear` (solo owners)
- 🎯 **Apuestas deportivas** de cuotas fijas. Los clientes apuestan **a golpe de clic** en el tablero de botones del mercado (no hay comando de apuesta). Los mercados los abren los owners con `/mercado` (comando solo visible para admins) y se publican en el canal de apuestas (`config.betChannel`) o en el canal que se indique con la opción `canal`. Dos formas de crear mercados:
  - `/mercado crear` — mercado manual para cualquier evento (ej: *Madrid 2.1, Empate 3.3, Barça 3.4*); el owner lo resuelve con `/mercado resolver`.
  - `/mercado partido` — mercado de un **evento real** que se **resuelve solo** leyendo el resultado de ESPN (gratis, sin API key). Elige liga/deporte con **autocompletado** (27+): ⚽ fútbol a **1X2** (LaLiga, Premier, Champions, Europa, Serie A, Bundesliga, Ligue 1, MLS, Championship, Portugal, Eredivisie, Brasileirão, Argentina, Liga MX, Libertadores…) y a **2 opciones** el resto: 🏀 NBA/WNBA/Euroliga/NCAA, 🏈 NFL/NCAA, ⚾ MLB, 🏒 NHL, 🥊 UFC/PFL/Bellator (por combate) y 🎾 tenis ATP/WTA (por partido). Cierra apuestas al empezar y reembolsa si se suspende.
  - `/mercado cancelar` reembolsa un mercado.

> En cualquier apuesta puedes escribir `all`, `half`, `1k` o `2m`.
> Tras cada partida, el botón **🔄 Volver a jugar** repite con la misma apuesta sin reescribir el comando.

## 🚀 Puesta en marcha

### 1. Requisitos
- **Node.js 18 o superior** (necesario para `fetch` nativo y better-sqlite3).

### 2. Crear la aplicación de Discord
1. Entra en el [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. En **Bot** → *Reset Token* y copia el token.
3. En **General Information** copia el **Application ID**.
4. No hace falta activar *intents* privilegiados (el bot solo usa slash commands). *Excepción:* si activas el conteo de invitaciones del jackpot (`jackpot.trackInvites`), necesitarás el intent **Server Members** (ver sección de personalización).

### 3. Configurar el proyecto
```bash
cd "casino-bot"
npm install
cp .env.example .env
```
Edita `.env` y rellena:
```
DISCORD_TOKEN=tu_token
CLIENT_ID=tu_application_id
GUILD_ID=id_de_tu_servidor   # opcional: registra comandos al instante
```
> Para copiar el ID de tu servidor: en Discord activa *Ajustes → Avanzado → Modo desarrollador*, luego clic derecho en el servidor → *Copiar ID del servidor*.

### 4. Registrar los comandos e iniciar
```bash
npm run deploy   # registra los slash commands
npm start        # arranca el bot
```

### 5. Invitar el bot a tu servidor
Usa esta URL (sustituye `CLIENT_ID`):
```
https://discord.com/api/oauth2/authorize?client_id=CLIENT_ID&permissions=2147483648&scope=bot%20applications.commands
```
El permiso incluye *Enviar mensajes* y *Usar comandos de aplicación*.

## ⚙️ Personalización
Casi todo se ajusta en [`src/config.js`](src/config.js):
- **Nombre y símbolo de la moneda** (`currency`)
- **Nombre del casino** (`casino`)
- **Saldo inicial, recompensas, cooldowns** (`economy`)
- **Apuesta mínima/máxima** (`limits`)
- **Colores de los embeds** (`colors`)
- **Jackpot progresivo** (`jackpot`)

Los pagos de cada juego están dentro de su archivo en `src/commands/`.

### 🏆 Jackpot progresivo (`config.jackpot`)
- `seed` — valor base al que se reinicia el bote tras ganarlo (por defecto **1.000**).
- `contribution` — fracción de cada apuesta de `/slots` que alimenta el bote (por defecto **0.01** = 1%).
- `displayChannel` — ID del canal fijo donde se muestra el bote **en vivo** (un mensaje que se autoedita). Déjalo `''` para desactivarlo.
- `boardRefreshMs` — cada cuánto se refresca ese mensaje.
- `minAccountAgeDays` / `minInvites` — **anti cuentas falsas**: para *cobrar* el bote el usuario debe cumplir al menos una: cuenta de Discord con esa antigüedad, **o** haber invitado a esa cantidad de gente. Si no cumple, alinea los 💎 pero el bote **no** se entrega ni se reinicia.
- `trackInvites` — pon `true` para contar invitaciones (necesario para el requisito de invitados). ⚠️ Requiere activar el **intent privilegiado *Server Members*** en el [Developer Portal](https://discord.com/developers/applications) (Bot → *Privileged Gateway Intents*) y que el bot tenga permiso **Gestionar servidor**. Con `false` solo cuenta la antigüedad y el bot sigue sin intents privilegiados.

### 📊 Reporte diario (`config.dailyReport`)
Cada día, a una hora fija, el bot publica un resumen del casino en un canal. El bot va acumulando las estadísticas de cada partida mientras está encendido (si estuvo apagado a la hora del reporte, lo publica al volver).

```
📊 REPORTE DEL DÍA 08/08/2026
─────────────────────────────
Usuarios activos: 347
Apuestas totales: 12,450
Monedas apostadas: 1,234,500
Monedas ganadas: 1,109,800
Beneficio del servidor: 124,700 monedas (10.1%)
Top apostador: @Juanito (45,000 monedas)
Jackpot actual: 87,300 monedas
VIPs activos: 23
Ingresos estimados (ventas): 1,247 €
```

- `channel` — ID del canal donde se publica el reporte (`''` = desactivado).
- `hour` / `minute` — hora **local del servidor** a la que se publica (el reporte cubre el día que termina en ese momento; por defecto 23:59).
- `vipRole` — rol de Discord que cuenta como **VIP**; «VIPs activos» = usuarios que jugaron ese día y tienen ese rol. Déjalo `''` si no tienes VIPs (se mostrará 0).
- `coinsPerEuro` — «Ingresos estimados (ventas)» convierte el **beneficio del servidor** del día a euros con esta tasa (cuántas monedas equivalen a 1 €). Con `100`, un beneficio de 124.700 monedas = **1.247 €**.

Comando `/reporte` (solo owners): previsualiza el reporte de hoy en cualquier momento sin esperar a la hora programada.

## 🗂️ Estructura
```
casino-bot/
├─ src/
│  ├─ index.js            # arranque del bot y router de interacciones
│  ├─ deploy-commands.js  # registro de slash commands
│  ├─ config.js           # configuración central
│  ├─ database/db.js      # SQLite (better-sqlite3)
│  ├─ lib/                # economía, apuestas, baraja, embeds, formato
│  └─ commands/           # un archivo por comando/juego
└─ data/casino.db         # base de datos (se crea sola)
```

## 📝 Notas
- La economía se guarda en `data/casino.db` (SQLite). Haz copia de ese archivo para no perder saldos.
- El juego `/cripto` usa la API pública y gratuita de CoinGecko para el precio real; si falla, sigue funcionando con un precio de reserva.
- Cada juego tiene una pequeña ventaja de la casa para que la economía no se descontrole.
