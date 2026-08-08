const OddsApi = require('./oddsApi');
const SportsCache = require('./sportsCache');
const SportsCleanup = require('./sportsCleanup');

class SportsUpdater {
    constructor(apiKey, dbPath) {
        this.api = new OddsApi(apiKey);
        this.cache = new SportsCache(dbPath);
        this.cleanup = new SportsCleanup(dbPath, this.api);

        this.sportsToTrack = {
            'football': { leagues: ['UEFA Champions League', 'Premier League', 'La Liga', 'Bundesliga', 'Serie A'] },
            'basketball': { leagues: ['NBA', 'EuroLeague'] },
            'mma': { leagues: ['UFC', 'Bellator'] }
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
                const events = await this.api.getEvents(sport, null, 30);
                allEvents = events || [];
            } catch (error) {
                console.error(`[Updater] Error sin filtro: ${error.message}`);
            }
        }

        if (allEvents.length === 0) {
            console.log(`[Updater] No hay eventos para ${sport}`);
            return { updated: 0 };
        }

        this.cache.saveEvents(allEvents, sport);

        const eventIds = allEvents.map(e => e.id);
        let oddsData = [];

        try {
            const odds = await this.api.getOddsMulti(eventIds);
            if (odds && odds.length > 0) {
                for (const odd of odds) {
                    oddsData.push({
                        event_id: odd.event_id,
                        bookmaker: odd.bookmaker,
                        market_type: 'moneyline',
                        home_odds: odd.odds?.home || null,
                        away_odds: odd.odds?.away || null,
                        draw_odds: odd.odds?.draw || null
                    });
                }
                this.cache.saveOdds(oddsData);
            }
        } catch (error) {
            console.error(`[Updater] Error obteniendo cuotas: ${error.message}`);
        }

        console.log(`[Updater] ${sport}: ${allEvents.length} eventos`);
        return { updated: allEvents.length, odds: oddsData.length };
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
