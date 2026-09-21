import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

const API = 'http://localhost:4000';

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

// Cada participante entra con su propia cuenta, como en la realidad.
const sesiones = {
  Eduardo: await sesionDePrueba('Eduardo'),
  Ana: await sesionDePrueba('Ana'),
  Luis: await sesionDePrueba('Luis'),
};
const duenio = sesiones.Eduardo.token;

// La pizarra la crea Eduardo, que queda como anfitrion.
const board = await (await fetch(`${API}/api/boards`, conAuth(duenio, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: `Colaboracion ${Date.now()}` }),
}))).json();
const diagramId = board.diagram_id;

function client(name, color) {
  const clientId = randomUUID();
  const ws = new WebSocket('ws://localhost:4000/ws');
  const state = { clientId, name, doc: null, seq: 0, presence: [], acks: [] };
  ws.on('message', raw => {
    const m = JSON.parse(String(raw));
    if (m.type === 'snapshot') { state.doc = m.doc; state.seq = m.seq; }
    if (m.type === 'ops') { for (const op of m.ops) { applyLocal(state, op); state.seq = op.seq; } }
    if (m.type === 'ack') { state.acks.push(m); if (m.seq) state.seq = m.seq; if (m.rejected.length) state.rejected = (state.rejected||0)+m.rejected.length; }
    if (m.type === 'presence') state.presence = m.participants;
    if (m.type === 'error') console.error(`[${name}] ERROR`, m.message);
  });
  state.ws = ws;
  state.ready = new Promise(r => ws.on('open', () => {
    ws.send(JSON.stringify({ type:'join', diagramId, clientId, name, color, lastSeq: state.seq, token: sesiones[name]?.token }));
    setTimeout(r, 300);
  }));
  state.send = ops => { for (const op of ops) applyLocal(state, op); ws.send(JSON.stringify({ type:'ops', ops })); };
  state.sendRaw = ops => ws.send(JSON.stringify({ type:'ops', ops }));
  return state;
}

// Reaplicamos localmente igual que hace el navegador (optimista)
function applyLocal(s, op) {
  if (!s.doc) s.doc = { nodes: [], edges: [], deleted: [] };
  const d = s.doc, p = op.payload;
  if (op.kind === 'node.add') { const i = d.nodes.findIndex(n=>n.id===p.node.id); i>=0 ? d.nodes[i]={...d.nodes[i],...p.node} : d.nodes.push(p.node); }
  if (op.kind === 'node.update') { const i = d.nodes.findIndex(n=>n.id===p.id); if(i>=0) d.nodes[i]={...d.nodes[i],...p.patch,data:{...d.nodes[i].data,...(p.patch.data??{})}}; }
  if (op.kind === 'node.move') { const n = d.nodes.find(n=>n.id===p.id); if(n) n.position=p.position; }
  if (op.kind === 'node.remove') { d.nodes=d.nodes.filter(n=>n.id!==p.id); d.edges=d.edges.filter(e=>e.source!==p.id&&e.target!==p.id); }
  if (op.kind === 'edge.add') { d.edges.push(p.edge); }
}

const mkOp = (s, kind, payload) => ({ opId: randomUUID(), kind, clientId: s.clientId, actorName: s.name, localTs: Date.now(), payload });
const node = (id,label,x,y) => ({ id, type:'default', position:{x,y}, data:{ label, attributes:[] } });
const wait = ms => new Promise(r=>setTimeout(r,ms));

console.log('=== 1) Tres sesiones colaborativas simultaneas ===');
const a = client('Eduardo', '#e74c3c');
const b = client('Ana', '#27ae60');
const c = client('Luis', '#2980b9');
await Promise.all([a.ready, b.ready, c.ready]);
await wait(300);
console.log('participantes vistos por Eduardo:', a.presence.map(p=>p.name).sort().join(', '));

// Cada uno crea una clase AL MISMO TIEMPO. Con el codigo viejo se pisaban.
const nA = node('n-mascota','Mascota',100,100);
const nB = node('n-dueno','Dueno',400,100);
const nC = node('n-consulta','Consulta',700,100);
a.send([mkOp(a,'node.add',{node:nA})]);
b.send([mkOp(b,'node.add',{node:nB})]);
c.send([mkOp(c,'node.add',{node:nC})]);
await wait(700);
for (const s of [a,b,c]) {
  console.log(`  ${s.name} ve ${s.doc.nodes.length} clases: ${s.doc.nodes.map(n=>n.data.label).sort().join(', ')}`);
}

console.log('\n=== 2) Dos personas editando la MISMA clase en campos distintos ===');
// Ana renombra, Luis le agrega atributos. Ambos cambios deben sobrevivir.
b.send([mkOp(b,'node.update',{id:'n-mascota',patch:{data:{label:'MascotaVet'}}})]);
c.send([mkOp(c,'node.update',{id:'n-mascota',patch:{data:{attributes:[{id:'a1',name:'nombre',type:'String',scope:'private'}]}}})]);
await wait(700);
const m = a.doc.nodes.find(n=>n.id==='n-mascota');
console.log('  resultado:', m.data.label, '| atributos:', m.data.attributes.map(x=>x.name).join(','));
console.log('  ambos cambios sobrevivieron:', m.data.label==='MascotaVet' && m.data.attributes.length===1 ? 'SI' : 'NO');

console.log('\n=== 3) Desconexion y trabajo offline ===');
c.ws.close();
await wait(400);
console.log('  participantes tras salir Luis:', a.presence.map(p=>p.name).sort().join(', '));
// Luis sigue trabajando sin red: acumula ops en su cola local
const offlineOps = [
  mkOp(c,'node.add',{node:node('n-vacuna','Vacuna',700,300)}),
  mkOp(c,'node.move',{id:'n-consulta',position:{x:750,y:150}}),
];
// Mientras tanto Eduardo cambia otra cosa
a.send([mkOp(a,'node.add',{node:node('n-factura','Factura',100,400)})]);
await wait(400);

console.log('  Luis reconecta y vacia su cola...');
const c2 = client('Luis', '#2980b9');
c2.clientId = c.clientId; c2.seq = c.seq; c2.doc = c.doc;
await c2.ready;
c2.send(offlineOps);
await wait(700);
console.log(`  Eduardo ve ${a.doc.nodes.length} clases: ${a.doc.nodes.map(n=>n.data.label).sort().join(', ')}`);
const cons = a.doc.nodes.find(n=>n.id==='n-consulta');
console.log('  el movimiento offline se aplico:', cons.position.x===750 ? 'SI':'NO');

console.log('\n=== 4) Reenvio duplicado de la cola (idempotencia) ===');
const before = a.doc.nodes.length;
c2.sendRaw(offlineOps);  // mismo lote otra vez, como si el ack se hubiera perdido
await wait(700);
console.log(`  clases antes ${before}, despues ${a.doc.nodes.length} -> ${before===a.doc.nodes.length?'sin duplicados':'DUPLICO'}`);

console.log('\n=== 5) Borrado vs edicion tardia (tombstone) ===');
a.send([mkOp(a,'node.remove',{id:'n-vacuna'})]);
await wait(400);
c2.sendRaw([mkOp(c2,'node.add',{node:node('n-vacuna','Vacuna',0,0)})]); // op tardia
await wait(600);
console.log('  ops rechazadas detectadas por el cliente:', c2.rejected||0);
console.log('  la clase borrada resucito:', a.doc.nodes.some(n=>n.id==='n-vacuna') ? 'SI (mal)':'NO (correcto)');

console.log('\n=== 6) Estado final persistido en Postgres ===');
const snap = await (await fetch(`${API}/api/diagrams/${diagramId}`, conAuth(duenio))).json();
console.log('  seq:', snap.seq, '| clases:', snap.doc.nodes.map(n=>n.data.label).sort().join(', '));
const ops = await (await fetch(`${API}/api/diagrams/${diagramId}/ops?since=0`, conAuth(duenio))).json();
console.log('  bitacora de auditoria:', ops.length, 'operaciones');
console.log('  por autor:', Object.entries(ops.reduce((acc,o)=>{acc[o.actorName]=(acc[o.actorName]||0)+1;return acc;},{})).map(([k,v])=>`${k}=${v}`).join(' '));

for (const s of [a,b,c2]) s.ws.close();
await wait(200);
process.exit(0);
