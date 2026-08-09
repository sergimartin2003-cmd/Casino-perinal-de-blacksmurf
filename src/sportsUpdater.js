const OddsApi = require('./oddsApi');
const SportsCache = require('./sportsCache');
const SportsCleanup = require('./sportsCleanup');
const config = require('./config');

// Mapea el estado de la Odds API a los estados internos.
function mapStatus(s) {
    const v = String(s || '').toLowerCase();
    if (['settled', 'finished', 'closed', 'ended', 'ft', 'complete'].includes(v)) return 'finished';
    if (['inplay', 'live', 'playing', 'started'].includes(v)) return 'live';
    return 'scheduled';
}

class SportsUpdater {
    constructor(apiKey, dbPath) {
        this.api = new OddsApi(apiKey);
        this.cache = new SportsCache(dbPath);
        this.cleanup = new SportsCleanup(dbPath, this.api);

        // leagues vacío = trae eventos por DEPORTE (sin depender de slugs de liga,
        // que varían por proveedor). Se pueden reañadir ligas concretas por slug
        // (p. ej. 'premier-league', 'usa-nba') cuando se confirmen en la API.
        this.sportsToTrack = {
            'football': { leagues: [] },
            'basketball': { leagues: [] }
        };
    }

    // Elige las casas de apuestas a pedir. Manda EXACTAMENTE las que tú
    // configuraste en config.sports.bookmakers (p. ej. "Stake,bet365"), porque
    // el plan de odds-api.io bloquea la selección en el servidor: si pides otras
    // o más de la cuenta, devuelve 403. Si no configuras ninguna, prueba unas
    // recreativas y dejamos que el 403 nos diga cuáles permite tu plan.
    async getValidBookmakers() {
        if (this._bmFetched) return this._bookmakers;
        this._bmFetched = true;
        this._bookmakers = '';
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const userPref = String(config.sports?.bookmakers || '').split(',').map((x) => x.trim()).filter(Boolean);
        const RECREATIONAL = ['bet365', 'stake', 'williamhill', 'unibet', 'betway', '888sport'];
        try {
            const list = await this.api.getBookmakers();
            const arr = Array.isArray(list) ? list : (list?.bookmakers || list?.data || list?.results || []);
            const available = new Map();
            for (const b of arr) {
                const name = typeof b === 'string' ? b : (b.name ?? b.slug ?? b.key ?? b.id);
                if (name) available.set(norm(name), name);
            }
            let chosen;
            if (userPref.length) {
                // Usa TAL CUAL tus casas (casadas con el nombre exacto de la API si existe).
                chosen = userPref.map((p) => available.get(norm(p)) || p);
            } else {
                // Sin preferencia: prueba 2 recreativas; el plan las recortará y aprenderemos cuáles valen.
                chosen = RECREATIONAL.map((r) => available.get(r)).filter(Boolean).slice(0, 2);
            }
            this._bookmakers = chosen.join(',');
            if (!this._bmSampleLogged) {
                this._bmSampleLogged = true;
                console.log('[Updater] Bookmakers disponibles (muestra):', [...available.values()].slice(0, 25).join(', '));
            }
            console.log(`[Updater] Usando bookmakers: ${this._bookmakers || '(ninguno reconocido — mira la muestra de arriba)'}`);
        } catch (e) {
            console.error('[Updater] No pude obtener bookmakers:', e.message);
            // Si no pudimos listar, usa tu preferencia tal cual la escribiste.
            this._bookmakers = userPref.join(',');
        }
        return this._bookmakers;
    }

    // Extrae las casas permitidas de un error 403 del tipo:
    // "You're allowed max 2 bookmakers. Allowed: Bet365, Stake. To reset..."
    _parseAllowedBookmakers(msg) {
        const s = String(msg || '');
        const i = s.indexOf('Allowed:');
        if (i === -1) return null;
        // Corta la lista justo antes del ". To reset" / ". Upgrade" que la sigue.
        let rest = s.slice(i + 'Allowed:'.length).split(/\.\s+(?:To reset|Upgrade|Visit)/i)[0];
        const books = rest.split(',').map((x) => x.trim().replace(/\.\s*$/, '')).filter(Boolean);
        return books.length ? books.join(',') : null;
    }

    // Pide cuotas con auto-corrección: si el plan responde 403 diciendo qué casas
    // permite, aprende esa lista y reintenta (y la reutiliza en adelante).
    async _fetchOddsSmart(eventIds) {
        if (this._allowedBookmakers) {
            return await this._fetchOdds(eventIds, this._allowedBookmakers);
        }
        const bms = await this.getValidBookmakers();
        try {
            return await this.api.getOddsMulti(eventIds, bms);
        } catch (e) {
            const allowed = this._parseAllowedBookmakers(e.message);
            if (allowed && allowed !== bms) {
                this._allowedBookmakers = allowed;
                console.log(`[Updater] Tu plan solo permite estas casas: ${allowed}. Las usaré a partir de ahora.`);
                return await this._fetchOdds(eventIds, allowed);
            }
            console.error(`[Updater] Cuotas con [${bms}] falló: ${e.message}`);
            return [];
        }
    }

    // Pide cuotas devolviendo [] si falla (para no romper el ciclo de actualización).
    async _fetchOdds(eventIds, bookmakers) {
        try {
            return await this.api.getOddsMulti(eventIds, bookmakers);
        } catch (e) {
            console.error(`[Updater] Cuotas con [${bookmakers}] falló: ${e.message}`);
            return [];
        }
    }

    async updateAllSports() {
        console.log('[Updater] Actualizando todos los deportes...');
        const results = {};

        for (const [sport, config] of Object.entries(this.sportsToTrack)) {
            try {
                results[sport] = await this.updateSport(sport, config.leagues);
            } catch (error) {
                console.error(`[Updater] Error en ${sport}: ${error.message}`);
                results[sport] = { error: error.message };
            }
        }

        return results;
    }

    async updateSport(sport, leagues) {
        console.log(`[Updater] Actualizando ${sport}...`);

        let allEvents = [];

        for (const league of leagues) {
            try {
                const events = await this.api.getEvents(sport, league, 20);
                if (events && events.length > 0) {
                    allEvents = allEvents.concat(events);
                }
            } catch (error) {
                console.error(`[Updater] Error en ${league}: ${error.message}`);
            }
        }

        if (allEvents.length === 0) {
            try {
                const events = await this.api.getEvents(sport, null, 50);
                allEvents = events || [];
            } catch (error) {
                console.error(`[Updater] Error sin filtro: ${error.message}`);
            }
        }

        if (allEvents.length === 0) {
            console.log(`[Updater] No hay eventos para ${sport}`);
            return { updated: 0 };
        }

        // Muestra un evento crudo (solo la primera vez) para ver el formato real.
        if (!this._sampleLogged) {
            this._sampleLogged = true;
            console.log('[Updater] Ejemplo de evento crudo:', JSON.stringify(allEvents[0]).slice(0, 500));
        }

        // Normaliza (la API puede usar otros nombres de campo) y descarta incompletos.
        const norm = allEvents.map((e) => ({
            id: String(e.id ?? e.eventId ?? e.event_id ?? ''),
            // league viene como objeto { name, slug } en odds-api.io.
            league: e.league?.name ?? e.league?.slug ?? (typeof e.league === 'string' ? e.league : 'Unknown'),
            home_team: e.home ?? e.home_team ?? e.homeTeam ?? e.teams?.home ?? '?',
            away_team: e.away ?? e.away_team ?? e.awayTeam ?? e.teams?.away ?? '?',
            start_time: e.date ?? e.start_time ?? e.commence_time ?? e.starts ?? e.startTime ?? null,
            status: mapStatus(e.status),
            // Marcador (si el evento ya viene con resultado).
            home_score: e.scores?.home ?? e.scores?.periods?.ft?.home ?? null,
            away_score: e.scores?.away ?? e.scores?.periods?.ft?.away ?? null,
        })).filter((e) => e.id && e.start_time);

        if (norm.length === 0) {
            console.log(`[Updater] Eventos recibidos pero sin campos reconocibles para ${sport} (revisa el ejemplo de arriba).`);
            return { updated: 0 };
        }

        this.cache.saveEvents(norm, sport);

        // Guarda el marcador real de los que ya vienen con resultado (para liquidar bien).
        for (const e of norm) {
            if (e.status === 'finished' && e.home_score != null && e.away_score != null) {
                this.cache.updateEventStatus(e.id, 'finished', e.home_score, e.away_score);
            }
        }

        const eventIds = norm.map((e) => e.id);
        let oddsData = [];

        try {
            const oddsResp = await this._fetchOddsSmart(eventIds);
            // La respuesta puede venir como array o envuelta en {data|events|results}.
            const evs = Array.isArray(oddsResp) ? oddsResp : (oddsResp?.data || oddsResp?.events || oddsResp?.results || []);
            if (!this._oddsSampleLogged && evs[0]) {
                this._oddsSampleLogged = true;
                console.log('[Updater] Ejemplo de cuota cruda:', JSON.stringify(evs[0]).slice(0, 800));
            }
            oddsData = this._parseOddsResponse(evs);
            if (oddsData.length > 0) this.cache.saveOdds(oddsData);
        } catch (error) {
            console.error(`[Updater] Error obteniendo cuotas: ${error.message}`);
        }

        const upcoming = this.cache.getActiveEvents(sport, 100).length;
        console.log(`[Updater] ${sport}: ${allEvents.length} recibidos · ${norm.length} guardados · ${upcoming} próximos · ${oddsData.length} cuotas (para el panel)`);
        return { updated: norm.length, upcoming, odds: oddsData.length };
    }

    // Convierte la respuesta de /odds/multi al formato que espera saveOdds.
    // Forma real de odds-api.io: cada evento trae bookmakers[] y cada casa
    // markets[] con el mercado 'ML' (moneyline), cuyas odds son [{home,draw,away}].
    // Se aceptan variantes de nombres por robustez ante cambios del proveedor.
    _parseOddsResponse(events) {
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const ML_NAMES = new Set(['ml', '1x2', 'moneyline', 'h2h', 'matchodds', 'moneyline3way', '3way', 'headtohead', 'fulltimeresult']);
        const out = [];
        for (const ev of (events || [])) {
            const evId = String(ev.id ?? ev.eventId ?? ev.event_id ?? '');
            if (!evId) continue;
            // bookmakers: array de {name, markets} o un objeto {NombreCasa: {...}}.
            const bookmakers = Array.isArray(ev.bookmakers) ? ev.bookmakers
                : (ev.bookmakers && typeof ev.bookmakers === 'object')
                    ? Object.entries(ev.bookmakers).map(([name, v]) => ({ name, ...(v || {}) }))
                    : [];
            for (const bk of bookmakers) {
                const bookieName = bk.name ?? bk.bookmaker ?? bk.key ?? 'Unknown';
                // markets: array de {name, odds} o un objeto {NombreMercado: odds}.
                const markets = Array.isArray(bk.markets) ? bk.markets
                    : (bk.markets && typeof bk.markets === 'object')
                        ? Object.entries(bk.markets).map(([name, v]) => ({ name, ...(v && typeof v === 'object' ? v : { odds: v }) }))
                        : [];
                const ml = markets.find((m) => ML_NAMES.has(norm(m.name ?? m.key ?? m.type)));
                // La línea puede ser un array (historial: cogemos la última) o un objeto.
                const line = ml
                    ? (Array.isArray(ml.odds) ? ml.odds[ml.odds.length - 1] : (ml.odds ?? ml))
                    : (bk.moneyline || bk.ml || bk.odds || null);
                if (!line || typeof line !== 'object') continue;
                const home = line.home ?? line['1'] ?? line.h ?? null;
                const draw = line.draw ?? line['X'] ?? line.x ?? line.d ?? null;
                const away = line.away ?? line['2'] ?? line.a ?? null;
                if (home == null && away == null) continue; // nada útil
                out.push({ event_id: evId, bookmaker: bookieName, market_type: 'moneyline', odds: { home, draw, away } });
            }
        }
        return out;
    }

    async checkFinishedEvents() {
        // El endpoint /events ya trae el marcador (scores.ft) de los partidos
        // terminados, así que la liquidación funciona sin este endpoint. Si la API
        // rechaza el formato de IDs (400), lo desactivamos para no ensuciar el log
        // ni gastar llamadas: los resultados llegan igual por la vía principal.
        if (this._resultsDisabled) return { checked: 0, skipped: true };
        console.log('[Updater] Verificando eventos finalizados...');

        const events = this.cache.db.prepare(`
            SELECT id, status, home_score, away_score
            FROM sports_events
            WHERE status = 'live'
            OR (status = 'scheduled' AND datetime(start_time) < datetime('now', '-3 hours'))
        `).all();

        if (events.length === 0) {
            console.log('[Updater] No hay eventos para verificar');
            return { checked: 0 };
        }

        const eventIds = events.map(e => e.id);
        let results = [];

        try {
            results = await this.api.getEventResults(eventIds);
        } catch (error) {
            // Un 400 (formato de ID) no se va a arreglar reintentando: desactiva este paso.
            if (/\b400\b/.test(error.message) || /invalid event id/i.test(error.message)) {
                this._resultsDisabled = true;
                console.log('[Updater] Resultados por /events/results desactivados (el marcador ya viene en /events).');
            } else {
                console.error(`[Updater] Error obteniendo resultados: ${error.message}`);
            }
            return { checked: 0, error: error.message };
        }

        let updated = 0;
        for (const result of results) {
            if (result.status === 'finished') {
                this.cache.updateEventStatus(
                    result.id,
                    'finished',
                    result.home_score || 0,
                    result.away_score || 0
                );
                updated++;
            }
        }

        console.log(`[Updater] ${updated} eventos finalizados`);
        return { checked: results.length, updated };
    }

    async fullUpdate() {
        console.log('[Updater] Actualización completa...');

        const updateResults = await this.updateAllSports();
        const checkResults = await this.checkFinishedEvents();
        const cleanupResults = await this.cleanup.cleanupOldEvents();

        const pendingBets = this.cache.db.prepare(`
            SELECT DISTINCT e.id, e.home_team, e.away_team, e.home_score, e.away_score
            FROM sports_events e
            JOIN sports_bets b ON e.id = b.event_id
            WHERE e.status = 'finished' AND b.status = 'pending'
        `).all();

        if (pendingBets.length > 0) {
            const SportsBetting = require('./sportsBetting');
            const betting = new SportsBetting(this.cache.db.name);

            for (const event of pendingBets) {
                // Sin marcador (0-0 y sin confirmar) = no hay resultado fiable -> reembolsa.
                if (!event.home_score && !event.away_score) {
                    const r = betting.cancelEventBets(event.id);
                    console.log(`[Updater] Evento ${event.id} sin resultado: ${r.cancelled} apuestas reembolsadas`);
                    continue;
                }
                const winner = event.home_score > event.away_score ? 'home' : event.away_score > event.home_score ? 'away' : 'draw';
                betting.settleEventBets(event.id, winner);
                console.log(`[Updater] Evento ${event.id} resuelto (${event.home_score}-${event.away_score})`);
            }
        }

        return {
            update: updateResults,
            check: checkResults,
            cleanup: cleanupResults,
            betsResolved: pendingBets.length
        };
    }

    scheduleUpdates(intervalMinutes = 15) {
        this.fullUpdate().catch((e) => console.error(`[Updater] Error: ${e.message}`));
        setInterval(() => {
            this.fullUpdate().catch((e) => console.error(`[Updater] Error: ${e.message}`));
        }, intervalMinutes * 60 * 1000);
        console.log(`[Updater] Programado cada ${intervalMinutes} minutos`);
    }
}

module.exports = SportsUpdater;
