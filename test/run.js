// Runner de tests de Nova Casino (sin dependencias externas).
// Ejecuta cada *.test.js en su PROPIO proceso con una base de datos temporal
// aislada (CASINO_DB_PATH), de modo que los tests no tocan tu data/casino.db real
// ni interfieren entre sí. Uso: `npm test`.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
const tmpFiles = [];
let failed = 0;

console.log(`\n=== Nova Casino · suite de tests (${files.length} archivos) ===`);
for (const f of files) {
  const tmp = path.join(os.tmpdir(), `casino-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tmpFiles.push(tmp);
  console.log(`\n▶ ${f}`);
  const res = spawnSync(process.execPath, [path.join(dir, f)], {
    stdio: 'inherit',
    env: { ...process.env, CASINO_DB_PATH: tmp },
    cwd: path.join(dir, '..'),
  });
  if (res.status !== 0) failed++;
}

// Limpia las BD temporales (y sus ficheros -wal/-shm de WAL).
for (const t of tmpFiles) for (const suf of ['', '-wal', '-shm']) { try { fs.unlinkSync(t + suf); } catch {} }

console.log(`\n=== Resultado: ${files.length - failed}/${files.length} archivos OK ===`);
process.exit(failed === 0 ? 0 : 1);
