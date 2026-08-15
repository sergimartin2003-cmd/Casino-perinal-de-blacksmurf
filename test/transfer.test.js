// Transferencia atómica (/give): importes correctos, rechazo por saldo,
// conservación (ni se crean ni se pierden monedas) y auditoría.
const db = require('../src/database/db');
const { setBalance, getUser, transfer } = require('../src/lib/economy');

let f = 0; const A = (c, l) => { console.log((c ? '  ✅ ' : '  ❌ ') + l); if (!c) f++; };
const A_ID = 'GV_a', B_ID = 'GV_b';
setBalance(A_ID, 1000); setBalance(B_ID, 500);
const totalBefore = getUser(A_ID).balance + getUser(B_ID).balance;

A(transfer(A_ID, B_ID, 300) === true, 'transfer(300) devuelve true');
A(getUser(A_ID).balance === 700, 'emisor 1000 -> 700');
A(getUser(B_ID).balance === 800, 'receptor 500 -> 800');
A(getUser(A_ID).balance + getUser(B_ID).balance === totalBefore, 'total conservado (ni se crean ni se pierden)');

const before = [getUser(A_ID).balance, getUser(B_ID).balance];
A(transfer(A_ID, B_ID, 999999) === false, 'transfer sin saldo devuelve false');
A(getUser(A_ID).balance === before[0] && getUser(B_ID).balance === before[1], 'saldos intactos tras el intento fallido');

A(transfer(A_ID, B_ID, 0) === false && transfer(A_ID, B_ID, -50) === false, 'rechaza 0 y negativos');
A(getUser(A_ID).balance === 700, 'saldo intacto tras importes inválidos');

const log = db.prepare('SELECT to_id, amount FROM transfers WHERE from_id = ? ORDER BY id DESC LIMIT 1').get(A_ID);
A(log && log.to_id === B_ID && log.amount === 300, 'la transferencia válida quedó auditada');

console.log('\n' + (f === 0 ? '✅ TRANSFER OK' : `❌ ${f} fallan`));
process.exit(f === 0 ? 0 : 1);
