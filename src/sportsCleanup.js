const sharedDb = require('./database/db');
const SportsBetting = require('./sportsBetting');

class SportsCleanup {
    constructor(dbPath, oddsApi) {
        // Reutiliza la conexión compartida (una sola por proceso) salvo en tests.
        this.db = sharedDb.openFor(dbPath);
        this.oddsApi = oddsApi;
        this.betting = new SportsBetting(dbPath);
    }

    async cleanupOldEvents(daysToKeep = 7) {
        console.log('[Cleanup] Iniciando limpieza...');

        const markStmt = this.db.prepare(`
            UPDATE sports_events
            SET status = 'finished'
            WHERE status != 'finished'
            AND datetime(start_time) < datetime('now', '-2 hours')
        `);
        const marked = markStmt.run();

        const pendingEvents = this.db.prepare(`
            SELECT DISTINCT e.id, e.home_team, e.away_team, e.home_score, e.away_score
            FROM sports_events e
            JOIN sports_bets b ON e.id = b.event_id
            WHERE e.status = 'finished'
            AND b.status = 'pending'
        `).all();

        for (const event of pendingEvents) {
            // Sin marcador (0-0 y sin confirmar) = no hay resultado fiable -> reembolsa.
            if (!event.home_score && !event.away_score) {
                const r = this.betting.cancelEventBets(event.id);
                console.log(`[Cleanup] Evento ${event.id} sin resultado: ${r.cancelled} apuestas reembolsadas`);
                continue;
            }
            const winner = event.home_score > event.away_score ? 'home' : event.away_score > event.home_score ? 'away' : 'draw';
            const results = this.betting.settleEventBets(event.id, winner);
            console.log(`[Cleanup] Evento ${event.id}: ${results.won} ganadas (${event.home_score}-${event.away_score})`);
        }

        const deleteStmt = this.db.prepare(`
            DELETE FROM sports_events
            WHERE status = 'finished'
            AND datetime(start_time) < datetime('now', ?)
        `);
        const deleted = deleteStmt.run(`-${daysToKeep + 3} days`);

        const cleanupOdds = this.db.prepare(`
            DELETE FROM sports_odds
            WHERE event_id NOT IN (SELECT id FROM sports_events)
        `);
        const oddsCleaned = cleanupOdds.run();

        return {
            markedFinished: marked.changes,
            resolvedEvents: pendingEvents.length,
            deletedOldEvents: deleted.changes,
            cleanedOrphanOdds: oddsCleaned.changes
        };
    }

    scheduleCleanup(intervalHours = 6) {
        this.cleanupOldEvents().catch((e) => console.error(`[Cleanup] Error: ${e.message}`));
        setInterval(() => {
            this.cleanupOldEvents().catch((e) => console.error(`[Cleanup] Error: ${e.message}`));
        }, intervalHours * 60 * 60 * 1000);
        console.log(`[Cleanup] Programado cada ${intervalHours} horas`);
    }
}

module.exports = SportsCleanup;
