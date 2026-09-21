// Verificacion del codigo de registro, que es lo que evita que cualquiera
// que encuentre la URL en internet se cree una cuenta.
const API = 'http://localhost:4000';
let ok = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { ok++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${d}`); } };

const post = (ruta, body) => fetch(`${API}${ruta}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const CODIGO = process.env.REGISTRO_CODIGO ?? '';
const correo = () => `r${Date.now()}${Math.random().toString(36).slice(2, 6)}@uagrm.edu.bo`;

console.log(`=== Modo del servidor (REGISTRO_CODIGO ${CODIGO ? 'definido' : 'vacio'}) ===`);
const modo = await fetch(`${API}/api/auth/modo`).then(r => r.json());
check('/api/auth/modo responde sin token', typeof modo.requiereCodigo === 'boolean');
check('informa si hace falta el codigo', modo.requiereCodigo === (CODIGO !== ''),
  `=> requiereCodigo=${modo.requiereCodigo}`);

if (CODIGO) {
  console.log('\n=== Con codigo configurado ===');
  let r = await post('/api/auth/registro', { correo: correo(), nombre: 'Sin Codigo', password: 'contrasena-larga-1' });
  check('sin codigo rechaza con 403', r.status === 403, `=> ${r.status}`);
  check('y lo explica', /codigo/i.test(r.body.error ?? ''), r.body.error);

  r = await post('/api/auth/registro', { correo: correo(), nombre: 'Codigo Malo', password: 'contrasena-larga-1', codigo: 'incorrecto' });
  check('con el codigo equivocado tambien rechaza', r.status === 403);

  const c = correo();
  r = await post('/api/auth/registro', { correo: c, nombre: 'Con Codigo', password: 'contrasena-larga-1', codigo: CODIGO });
  check('con el codigo correcto crea la cuenta', r.status === 201, `=> ${r.status} ${JSON.stringify(r.body)}`);
  check('y devuelve el token', typeof r.body.token === 'string');

  r = await post('/api/auth/login', { correo: c, password: 'contrasena-larga-1' });
  check('esa cuenta despues puede entrar sin codigo', r.status === 200);
} else {
  console.log('\n=== Sin codigo configurado: registro abierto ===');
  const r = await post('/api/auth/registro', { correo: correo(), nombre: 'Abierto', password: 'contrasena-larga-1' });
  check('cualquiera puede registrarse', r.status === 201, `=> ${r.status}`);
}

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
