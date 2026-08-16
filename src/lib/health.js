// Servidor HTTP mínimo SOLO para plataformas que exigen escuchar un puerto
// (p. ej. Render "Web Service", que marca el deploy como caído si nada escucha
// en $PORT). Si no hay process.env.PORT (arranque local, escritorio, worker), NO
// abre ningún puerto. No toca en absoluto la lógica del bot ni de los juegos.
const http = require('http');

/**
 * Arranca el servidor de salud si la plataforma define PORT.
 * @param {() => object} getStatus  datos extra a incluir en la respuesta JSON.
 * @returns {import('http').Server|null}
 */
function start(getStatus = () => ({})) {
  const port = process.env.PORT;
  if (!port) return null; // sin PORT (local) -> no se abre nada

  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
      let extra = {};
      try { extra = getStatus() || {}; } catch { /* nunca romper el health por esto */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', ...extra }));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  server.on('error', (e) => console.error('[health] error del servidor HTTP:', e.message));
  server.listen(port, () => console.log(`[health] servidor de salud escuchando en el puerto ${port}`));
  return server;
}

module.exports = { start };
