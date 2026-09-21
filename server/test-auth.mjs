// Verificacion de la autenticacion, la propiedad de las pizarras y los permisos.
import WebSocket from 'ws';

const API = 'http://localhost:4000';
const WS = 'ws://localhost:4000/ws';

let ok = 0, fail = 0;
const check = (n, cond, d = '') => {
  if (cond) { ok++; console.log(`  OK   ${n}`); }
  else { fail++; console.log(`  FALLA ${n} ${d}`); }
};
const esperar = ms => new Promise(r => setTimeout(r, ms));

const post = (ruta, body, token) =>
  fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const get = (ruta, token) =>
  fetch(`${API}${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const metodo = (m, ruta, token, body) =>
  fetch(`${API}${ruta}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const sufijo = Date.now();
const ANA = { correo: `ana${sufijo}@uagrm.edu.bo`, nombre: 'Ana Quispe', password: 'contrasena-larga-1' };
const LUIS = { correo: `luis${sufijo}@uagrm.edu.bo`, nombre: 'Luis Vargas', password: 'contrasena-larga-2' };

console.log('=== 1) Registro ===');
let r = await post('/api/auth/registro', ANA);
check('crea la cuenta', r.status === 201, `=> ${r.status} ${JSON.stringify(r.body)}`);
check('devuelve un token', typeof r.body.token === 'string' && r.body.token.split('.').length === 3);
check('devuelve el usuario sin la contrasena',
  r.body.usuario?.correo === ANA.correo && !('password' in (r.body.usuario ?? {})) &&
  !JSON.stringify(r.body).includes(ANA.password));
const tokenAna = r.body.token;
const idAna = r.body.usuario.id;

r = await post('/api/auth/registro', ANA);
check('no permite dos cuentas con el mismo correo', r.status === 409, `=> ${r.status}`);

r = await post('/api/auth/registro', { ...LUIS, password: 'corta' });
check('rechaza contrasenas cortas', r.status === 400);
r = await post('/api/auth/registro', { ...LUIS, correo: 'no-es-un-correo' });
check('rechaza un correo mal formado', r.status === 400);

r = await post('/api/auth/registro', LUIS);
const tokenLuis = r.body.token;
check('registra al segundo usuario', r.status === 201);

console.log('\n=== 2) Inicio de sesion ===');
r = await post('/api/auth/login', { correo: ANA.correo, password: ANA.password });
check('entra con la contrasena correcta', r.status === 200 && typeof r.body.token === 'string');
r = await post('/api/auth/login', { correo: ANA.correo, password: 'otra-cosa-larga' });
check('rechaza la contrasena incorrecta', r.status === 401);
r = await post('/api/auth/login', { correo: `nadie${sufijo}@x.com`, password: ANA.password });
check('rechaza un correo inexistente', r.status === 401);
check('no revela si el correo existe o no',
  r.body.error === 'Correo o contrasena incorrectos', r.body.error);

console.log('\n=== 3) El token protege la API ===');
r = await get('/api/boards');
check('sin token responde 401', r.status === 401, `=> ${r.status}`);
r = await get('/api/boards', 'no.es.un.token');
check('con un token invalido responde 401', r.status === 401);
r = await get('/api/boards', tokenAna);
check('con token valido responde 200', r.status === 200);

// Un token con la carga alterada tiene que caer por la firma.
const partes = tokenAna.split('.');
const carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString());
carga.sub = '00000000-0000-0000-0000-000000000000';
const falsificado = `${partes[0]}.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.${partes[2]}`;
r = await get('/api/auth/yo', falsificado);
check('un token con la carga cambiada se rechaza', r.status === 401, `=> ${r.status}`);

// "alg": "none" es el ataque clasico contra JWT.
const cabNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
r = await get('/api/auth/yo', `${cabNone}.${partes[1]}.`);
check('rechaza el token con alg none', r.status === 401);

r = await get('/api/auth/yo', tokenAna);
check('sesion actual devuelve el usuario', r.body.usuario?.correo === ANA.correo);

console.log('\n=== 4) Propiedad de la pizarra ===');
r = await post('/api/boards', { name: 'Pizarra de Ana' }, tokenAna);
check('la crea', r.status === 201, `=> ${r.status}`);
check('queda como propietaria', r.body.owner_id === idAna && r.body.soy_propietario === true);
const pizarra = r.body.id;
const diagrama = r.body.diagram_id;

r = await get('/api/boards', tokenAna);
check('Ana la ve en su lista', r.body.some(b => b.id === pizarra));
r = await get('/api/boards', tokenLuis);
check('Luis todavia no la ve', !r.body.some(b => b.id === pizarra), `=> ${JSON.stringify(r.body.map(b => b.id))}`);

console.log('\n=== 5) Permisos del anfitrion ===');
r = await metodo('PATCH', `/api/boards/${pizarra}`, tokenLuis, { name: 'Secuestrada' });
check('otro usuario no puede renombrarla', r.status === 403, `=> ${r.status}`);
r = await metodo('DELETE', `/api/boards/${pizarra}`, tokenLuis);
check('ni eliminarla', r.status === 403, `=> ${r.status}`);
check('y el mensaje lo explica', /anfitrion/i.test(r.body.error ?? ''), r.body.error);
r = await metodo('PATCH', `/api/boards/${pizarra}`, tokenAna, { name: 'Pizarra de Ana II' });
check('la anfitriona si puede renombrarla', r.status === 200 && r.body.name === 'Pizarra de Ana II');

console.log('\n=== 6) Entrar con el enlace suma como editor ===');
r = await get(`/api/diagrams/${diagrama}`, tokenLuis);
check('Luis puede abrir el diagrama con el enlace', r.status === 200, `=> ${r.status}`);
check('y queda como editor, no propietario', r.body.rol === 'editor', `=> ${r.body.rol}`);
r = await get('/api/boards', tokenLuis);
check('ahora si la ve en su lista', r.body.some(b => b.id === pizarra));
check('pero no como propietario', r.body.find(b => b.id === pizarra)?.soy_propietario === false);
r = await get(`/api/diagrams/${diagrama}`);
check('sin token no se puede abrir', r.status === 401);

console.log('\n=== 7) El WebSocket tambien exige el token ===');
function conectar(token, nombre) {
  return new Promise(resolve => {
    const ws = new WebSocket(WS);
    const est = { presencia: [], errores: [], cerrado: false, ws };
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      if (m.type === 'presence') est.presencia = m.participants;
      if (m.type === 'error') est.errores.push(m.message);
    });
    ws.on('close', () => { est.cerrado = true; });
    ws.on('error', () => {});
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'join', diagramId: diagrama, clientId: `cli-${nombre}`,
        name: nombre, color: '#888', lastSeq: 0, ...(token ? { token } : {}),
      }));
      setTimeout(() => resolve(est), 500);
    });
  });
}

const sinToken = await conectar(null, 'Intruso');
check('sin token lo rechaza', sinToken.errores.some(e => /iniciar sesion/i.test(e)),
  JSON.stringify(sinToken.errores));
check('y cierra la conexion', sinToken.cerrado);

const conAna = await conectar(tokenAna, 'Ana');
check('con token entra', conAna.errores.length === 0, JSON.stringify(conAna.errores));
check('la identidad sale del token, no del mensaje',
  conAna.presencia.some(p => p.name === 'Ana Quispe'),
  JSON.stringify(conAna.presencia.map(p => p.name)));
check('la propietaria es la anfitriona',
  conAna.presencia.find(p => p.esAnfitrion)?.name === 'Ana Quispe');

const conLuis = await conectar(tokenLuis, 'Luis');
await esperar(400);
check('el segundo entra como editor',
  conLuis.presencia.find(p => p.name === 'Luis Vargas')?.rol === 'editor',
  JSON.stringify(conLuis.presencia.map(p => [p.name, p.rol])));
check('y el anfitrion sigue siendo la propietaria, no el mas antiguo',
  conLuis.presencia.find(p => p.esAnfitrion)?.name === 'Ana Quispe');

// El nombre del mensaje no puede suplantar a otro usuario.
const impostor = await conectar(tokenLuis, 'Ana Quispe');
await esperar(300);
check('no se puede suplantar a otro mandando su nombre',
  impostor.presencia.filter(p => p.name === 'Ana Quispe').length === 1,
  JSON.stringify(impostor.presencia.map(p => p.name)));

conAna.ws.close(); conLuis.ws.close(); impostor.ws.close();
await esperar(200);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
