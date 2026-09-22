// Invitaciones por pizarra: el reemplazo del codigo de registro global.
//
// Lo que se verifica no es "el endpoint responde 200", sino las reglas que
// hacen que una invitacion sea mejor que un codigo compartido: nace de una
// pizarra, solo la crea su anfitrion, sirve para registrarse sin el codigo
// global, respeta el rol y el limite de usos, y se puede revocar.
//
// Requiere el servidor levantado con REGISTRO_CODIGO configurado.
const API = 'http://localhost:4000';

let ok = 0;
let fail = 0;
const check = (n, cond, d = '') => {
  if (cond) {
    ok++;
    console.log(`  OK   ${n}`);
  } else {
    fail++;
    console.log(`  FALLA ${n} ${d}`);
  }
};

const pedir = (metodo, ruta, { body, token } = {}) =>
  fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

const unico = () => Math.random().toString(36).slice(2, 10);

const CODIGO = process.env.REGISTRO_CODIGO_TEST ?? 'SECRETO-DE-PRUEBA';

async function registrar({ codigo, invitacion } = {}) {
  const correo = `u${unico()}@ejemplo.com`;
  const r = await pedir('POST', '/api/auth/registro', {
    body: {
      correo,
      nombre: 'Usuario de Prueba',
      password: 'contrasena-larga-1',
      ...(codigo ? { codigo } : {}),
      ...(invitacion ? { invitacion } : {}),
    },
  });
  return { ...r, correo };
}

console.log('=== 1) El codigo global sigue siendo obligatorio sin invitacion ===');
const sinNada = await registrar();
check('sin codigo ni invitacion no se puede registrar', sinNada.status === 403, sinNada.status);
check(
  'y el mensaje sugiere el enlace de invitacion',
  /invitacion/i.test(sinNada.body.error ?? ''),
  sinNada.body.error
);

const anfitrion = await registrar({ codigo: CODIGO });
check('con el codigo si', anfitrion.status === 201, anfitrion.status);
const tokenAnfitrion = anfitrion.body.token;

console.log('\n=== 2) Solo el anfitrion crea invitaciones ===');
const pizarra = await pedir('POST', '/api/boards', {
  token: tokenAnfitrion,
  body: { name: 'Pizarra con invitados' },
});
check('el anfitrion crea su pizarra', pizarra.status === 201, pizarra.status);
const boardId = pizarra.body.id;

const ajeno = await registrar({ codigo: CODIGO });
const intruso = await pedir('POST', `/api/boards/${boardId}/invitaciones`, {
  token: ajeno.body.token,
  body: {},
});
check('otro usuario no puede invitar a una pizarra ajena', intruso.status === 403, intruso.status);

const inv = await pedir('POST', `/api/boards/${boardId}/invitaciones`, {
  token: tokenAnfitrion,
  body: { rol: 'lector', usosMax: 1 },
});
check('el anfitrion crea la invitacion', inv.status === 201, inv.status);
check('con el rol que eligio', inv.body.rol === 'lector', inv.body.rol);
check('con el limite de usos que eligio', inv.body.usosMax === 1, inv.body.usosMax);
check('y un token largo, no adivinable', String(inv.body.token ?? '').length >= 40);

console.log('\n=== 3) El invitado ve a que lo invitaron antes de registrarse ===');
const vistaPrevia = await pedir('GET', `/api/auth/invitacion/${inv.body.token}`);
check('la vista previa no pide sesion', vistaPrevia.status === 200, vistaPrevia.status);
check('y dice el nombre de la pizarra', vistaPrevia.body.pizarra === 'Pizarra con invitados', vistaPrevia.body.pizarra);
const inexistente = await pedir('GET', '/api/auth/invitacion/token-que-no-existe-pero-es-largo-igual');
check('un token inventado no revela nada', inexistente.status === 404, inexistente.status);

console.log('\n=== 4) Registrarse con la invitacion, sin el codigo global ===');
const invitado = await registrar({ invitacion: inv.body.token });
check('el invitado se registra sin saber el codigo', invitado.status === 201, invitado.status);
check('y la respuesta le dice a que pizarra entro', invitado.body.pizarra === boardId, invitado.body.pizarra);

const susPizarras = await pedir('GET', '/api/boards', { token: invitado.body.token });
check(
  'la pizarra aparece en su lista',
  Array.isArray(susPizarras.body) && susPizarras.body.some(b => b.id === boardId)
);
check(
  'pero no figura como propietario',
  (susPizarras.body.find(b => b.id === boardId) ?? {}).soy_propietario === false
);

console.log('\n=== 5) El limite de usos se respeta ===');
const segundo = await registrar({ invitacion: inv.body.token });
check('la invitacion de un solo uso no sirve dos veces', segundo.status === 403, segundo.status);
const previaAgotada = await pedir('GET', `/api/auth/invitacion/${inv.body.token}`);
check('y deja de aparecer como valida', previaAgotada.status === 404, previaAgotada.status);

console.log('\n=== 6) Quien ya tiene cuenta usa el enlace igual ===');
const inv2 = await pedir('POST', `/api/boards/${boardId}/invitaciones`, {
  token: tokenAnfitrion,
  body: { rol: 'lector' },
});
const aceptar = await pedir('POST', `/api/invitaciones/${inv2.body.token}/aceptar`, {
  token: ajeno.body.token,
});
check('acepta la invitacion con su cuenta existente', aceptar.status === 200, aceptar.status);
check('y entra con el rol de la invitacion', aceptar.body.rol === 'lector', aceptar.body.rol);
const sinSesion = await pedir('POST', `/api/invitaciones/${inv2.body.token}/aceptar`);
check('sin sesion no se puede aceptar', sinSesion.status === 401, sinSesion.status);

console.log('\n=== 7) Revocar ===');
const inv3 = await pedir('POST', `/api/boards/${boardId}/invitaciones`, {
  token: tokenAnfitrion,
  body: {},
});
const vigentes = await pedir('GET', `/api/boards/${boardId}/invitaciones`, { token: tokenAnfitrion });
check(
  'el anfitrion ve sus invitaciones vigentes',
  Array.isArray(vigentes.body) && vigentes.body.some(i => i.token === inv3.body.token)
);
const revocada = await fetch(`${API}/api/boards/${boardId}/invitaciones/${encodeURIComponent(inv3.body.token)}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${tokenAnfitrion}` },
});
check('la revoca', revocada.status === 204, revocada.status);
const trasRevocar = await pedir('GET', `/api/auth/invitacion/${inv3.body.token}`);
check('y deja de servir al instante', trasRevocar.status === 404, trasRevocar.status);
const registroRevocado = await registrar({ invitacion: inv3.body.token });
check('tampoco sirve para registrarse', registroRevocado.status === 403, registroRevocado.status);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
