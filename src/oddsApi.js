// fetch nativo de Node 18+ (sin dependencia externa).
const fetch = globalThis.fetch;

class OddsApi {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.odds-api.io/v3';
        // Slugs de deporte de odds-api.io (fútbol es 'football', NO 'soccer').
        this.sportsMap = {
            'football': 'football',
            'basketball': 'basketball',
            'tennis': 'tennis'
        };
        this.dailyLimit = 500;
        this.callsToday = 0;
        this.resetTime = new Date();
        this.resetTime.setHours(0, 0, 0, 0);
    }

    canMakeCall() {
        const now = new Date();
        if (now > this.resetTime) {
            this.callsToday = 0;
            this.resetTime.setDate(this.resetTime.getDate() + 1);
            this.resetTime.setHours(0, 0, 0, 0);
        }
        return this.callsToday < this.dailyLimit;
    }

    async _fetch(endpoint) {
        if (!this.canMakeCall()) {
            throw new Error(`Límite diario de ${this.dailyLimit} llamadas alcanzado.`);
        }

        const url = `${this.baseUrl}${endpoint}&apiKey=${this.apiKey}`;
        try {
            const response = await fetch(url);
            this.callsToday++;
            console.log(`[OddsAPI] Llamada #${this.callsToday}/${this.dailyLimit}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }
            return await response.json();
        } catch (error) {
            console.error(`[OddsAPI] Error: ${error.message}`);
            throw error;
        }
    }

    async getSports() {
        const url = `/sports`;
        const response = await fetch(`${this.baseUrl}${url}`);
        return response.json();
    }

    async getEvents(sport, league = null, limit = 20) {
        let endpoint = `/events?sport=${this.sportsMap[sport]}`;
        if (league) {
            endpoint += `&league=${encodeURIComponent(league)}`;
        }
        endpoint += `&limit=${limit}`;
        return this._fetch(endpoint);
    }

    async getOddsMulti(eventIds, bookmakers = 'bet365,pinnacle,williamhill,unibet,bwin') {
        if (!eventIds || eventIds.length === 0) return [];
        if (eventIds.length > 10) {
            const results = [];
            for (let i = 0; i < eventIds.length; i += 10) {
                const batch = eventIds.slice(i, i + 10);
                const batchResults = await this.getOddsMulti(batch, bookmakers);
                results.push(...batchResults);
            }
            return results;
        }

        const idsParam = eventIds.join(',');
        const endpoint = `/odds/multi?eventIds=${idsParam}&bookmakers=${encodeURIComponent(bookmakers)}`;
        return this._fetch(endpoint);
    }

    async getEventResults(eventIds) {
        if (!eventIds || eventIds.length === 0) return [];
        const idsParam = eventIds.join(',');
        const endpoint = `/events/results?eventIds=${idsParam}`;
        return this._fetch(endpoint);
    }
}

module.exports = OddsApi;
