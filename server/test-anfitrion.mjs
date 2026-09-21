// Verificacion del anfitrion de sesion y de la plantilla inicial.
// El enunciado: "quien inicia la sesion, deberia haber algun anfitrion, si uno
// inicia por primera vez no deberia estar en blanco".
import WebSocket from 'ws';

const API = 'http://localhost:4000';
const WS = 'ws://localhost:4000/ws';

let ok = 0, fail = 0;
const check = (n, cond, d = '') => {
  if (cond) { ok++; console.log(`  OK   ${n}`); }
  else { fail++; console.log(`  FALLA ${n} ${d}`); }
};
const esperar = ms => new Promise(r => setTimeout(r, ms));

/**
 * Sesiones de prueba. Desde que el sistema tiene autenticacion, tanto la API
 * como el WebSocket exigen un token: las pruebas se registran como usuarios de
 * verdad en vez de saltarse la seguridad, que es la unica forma de que prueben
 * el camino que van a recorrer las personas.
 */
async function sesionDePrueba(nombre) {
  const correo = `prueba-${nombre.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@uagrm.edu.bo`;
  const r = await fetch(`${API}/api/auth/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, nombre, password: 'contrasena-de-prueba-1' }),
  });
  if (!r.ok) throw new Error(`No se pudo registrar a ${nombre}: ${r.status}`);
  return r.json();
}

const conAuth = (token, init = {}) => ({
  ...init,
  headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
});

const ANA = await sesionDePrueba('Ana');
const LUIS = await sesionDePrueba('Luis');
const EDUARDO = await sesionDePrueba('Eduardo');
const TOKENS = { Ana: ANA.token, Luis: LUIS.token, Eduardo: EDUARDO.token };


function conectar(diagramId, clientId, nombre) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const estado = { presencia: [], ws };
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.type === 'presence') estado.presencia = m.participants;
    });
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join', diagramId, clientId, name: nombre, color: '#888', lastSeq: 0, token: TOKENS[nombre] }));
      setTimeout(() => resolve(estado), 350);
    });
    ws.on('error', reject);
  });
}

console.log('=== 1) Una pizarra nueva no arranca en blanco ===');
// La crea Ana, asi que Ana es la anfitriona por propiedad, no por antiguedad.
const board = await fetch(`${API}/api/boards`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANA.token}` },
  body: JSON.stringify({ name: 'Prueba anfitrion' }),
}).then(r => r.json());
const diagramId = board.diagram_id;
const diagrama = await fetch(`${API}/api/diagrams/${diagramId}`, {
  headers: { Authorization: `Bearer ${ANA.token}` },
}).then(r => r.json());
check('trae clases de arranque', (diagrama.doc?.nodes ?? []).length >= 2,
  `=> ${(diagrama.doc?.nodes ?? []).length}`);
check('trae una relacion de ejemplo', (diagrama.doc?.edges ?? []).length >= 1);
const conAttrs = (diagrama.doc?.nodes ?? []).every(n => (n.data?.attributes ?? []).length > 0);
check('las clases de ejemplo tienen atributos con tipo', conAttrs);
check('la relacion tiene multiplicidades',
  diagrama.doc.edges[0]?.data?.sourceMultiplicity === '1' &&
  diagrama.doc.edges[0]?.data?.targetMultiplicity === '*');

console.log('\n=== 2) El primero que entra es el anfitrion ===');
const a = await conectar(diagramId, 'cli-ana', 'Ana');
check('hay un anfitrion', a.presencia.filter(p => p.esAnfitrion).length === 1,
  `=> ${JSON.stringify(a.presencia)}`);
check('y es Ana, que entro primera', a.presencia.find(p => p.esAnfitrion)?.name === 'Ana');

console.log('\n=== 3) Los que entran despues no son anfitriones ===');
const b = await conectar(diagramId, 'cli-luis', 'Luis');
await esperar(400);
check('siguen siendo dos participantes', b.presencia.length === 2, `=> ${b.presencia.length}`);
check('el anfitrion sigue siendo uno solo', b.presencia.filter(p => p.esAnfitrion).length === 1);
check('y sigue siendo Ana', b.presencia.find(p => p.esAnfitrion)?.name === 'Ana');
check('Luis no es anfitrion', b.presencia.find(p => p.name === 'Luis')?.esAnfitrion !== true);

console.log('\n=== 4) Si el anfitrion se va, el rol se traspasa ===');
const c = await conectar(diagramId, 'cli-eduardo', 'Eduardo');
await esperar(300);
a.ws.close();
await esperar(700);
check('la sesion no se queda sin anfitrion', c.presencia.filter(p => p.esAnfitrion).length === 1,
  `=> ${JSON.stringify(c.presencia.map(p => [p.name, p.esAnfitrion]))}`);
// Ana es la propietaria: si se desconecta, el rol lo ejerce el mas antiguo de
// los que quedan, para que la sesion no quede sin anfitrion mientras no esta.
check('el rol lo ejerce Luis, el mas antiguo de los que quedan',
  c.presencia.find(p => p.esAnfitrion)?.name === 'Luis',
  `=> ${c.presencia.find(p => p.esAnfitrion)?.name}`);
check('Ana ya no aparece', !c.presencia.some(p => p.name === 'Ana'));

b.ws.close();
c.ws.close();
await esperar(200);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
