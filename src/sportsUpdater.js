const OddsApi = require('./oddsApi');
const SportsCache = require('./sportsCache');
const SportsCleanup = require('./sportsCleanup');

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
        })).filter((e) => e.id && e.start_time);

        if (norm.length === 0) {
            console.log(`[Updater] Eventos recibidos pero sin campos reconocibles para ${sport} (revisa el ejemplo de arriba).`);
            return { updated: 0 };
        }

        this.cache.saveEvents(norm, sport);

        const eventIds = norm.map((e) => e.id);
        let oddsData = [];

        try {
            const oddsResp = await this.api.getOddsMulti(eventIds);
            if (!this._oddsSampleLogged && Array.isArray(oddsResp) && oddsResp[0]) {
                this._oddsSampleLogged = true;
                console.log('[Updater] Ejemplo de cuota cruda:', JSON.stringify(oddsResp[0]).slice(0, 500));
            }
            if (Array.isArray(oddsResp)) {
                for (const odd of oddsResp) {
                    // Busca las cuotas moneyline en varias formas posibles.
                    const m = odd.odds || odd.moneyline || odd.markets?.moneyline || odd.markets?.h2h || {};
                    oddsData.push({
                        event_id: String(odd.eventId ?? odd.event_id ?? odd.id ?? ''),
                        bookmaker: odd.bookmaker ?? odd.bookmaker_name ?? odd.bookie ?? 'Unknown',
                        market_type: 'moneyline',
                        // saveOdds lee item.odds.{home,away,draw}
                        odds: {
                            home: m.home ?? m['1'] ?? null,
                            draw: m.draw ?? m['X'] ?? m.x ?? null,
                            away: m.away ?? m['2'] ?? null,
                        },
                    });
                }
                if (oddsData.length > 0) this.cache.saveOdds(oddsData);
            }
        } catch (error) {
            console.error(`[Updater] Error obteniendo cuotas: ${error.message}`);
        }

        const upcoming = this.cache.getActiveEvents(sport, 100).length;
        console.log(`[Updater] ${sport}: ${allEvents.length} recibidos · ${norm.length} guardados · ${upcoming} próximos (para el panel)`);
        return { updated: norm.length, upcoming, odds: oddsData.length };
    }

    async checkFinishedEvents() {
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
            console.error(`[Updater] Error obteniendo resultados: ${error.message}`);
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
                let winner = 'draw';
                if (event.home_score > event.away_score) winner = 'home';
                else if (event.away_score > event.home_score) winner = 'away';

                const settleResults = betting.settleEventBets(event.id, winner);
                console.log(`[Updater] Evento ${event.id} resuelto`);
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
