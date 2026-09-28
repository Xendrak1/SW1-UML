// La prueba de la clave de IA y el limite de a donde puede apuntar el usuario.
//
// El endpoint existe para que el usuario sepa si su clave sirve ANTES de mandar
// una instruccion. Y como la URL del proveedor la elige el, hay que comprobar
// que no se pueda usar al servidor de trampolin para pedir cosas dentro de su
// propia red, que es el riesgo de dejar que el cliente elija a donde se llama.
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

const unico = () => Math.random().toString(36).slice(2, 10);
const CODIGO = process.env.REGISTRO_CODIGO_TEST ?? 'SECRETO-DE-PRUEBA';

const registro = await fetch(`${API}/api/auth/registro`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    correo: `u${unico()}@ejemplo.com`,
    nombre: 'Probador de Claves',
    password: 'contrasena-larga-1',
    codigo: CODIGO,
  }),
}).then(r => r.json());
const token = registro.token;

const probar = cabeceras =>
  fetch(`${API}/api/ai/probar`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...cabeceras,
    },
    body: '{}',
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

console.log('=== 1) Sin clave no hay nada que probar ===');
const vacio = await probar({});
check('responde 400', vacio.status === 400, vacio.status);
check('y lo dice claro', /clave/i.test(vacio.body.error ?? ''), vacio.body.error);

console.log('\n=== 2) La URL del proveedor tiene que ser https ===');
const http = await probar({
  'x-ia-clave': 'sk-lo-que-sea',
  'x-ia-base-url': 'http://ejemplo.com/v1/chat/completions',
});
check('no falla con 500, contesta ok:false', http.status === 200 && http.body.ok === false, http.status);
check('explicando que tiene que ser https', /https/i.test(http.body.error ?? ''), http.body.error);

console.log('\n=== 3) No se puede usar el servidor para llegar a su red interna ===');
const internas = [
  'https://localhost/v1/chat/completions',
  'https://127.0.0.1/v1/chat/completions',
  'https://10.0.0.5/v1/chat/completions',
  'https://192.168.1.10/v1/chat/completions',
  'https://172.16.0.9/v1/chat/completions',
  // El endpoint de metadatos de AWS: el objetivo clasico de un SSRF, y el que
  // de verdad importa en este despliegue.
  'https://169.254.169.254/latest/meta-data/',
];
for (const url of internas) {
  const r = await probar({ 'x-ia-clave': 'sk-lo-que-sea', 'x-ia-base-url': url });
  check(
    `rechaza ${url.split('/')[2]}`,
    r.body.ok === false && /interna/i.test(r.body.error ?? ''),
    r.body.error
  );
}

console.log('\n=== 4) Una URL publica y valida se intenta de verdad ===');
const publico = await probar({
  'x-ia-clave': 'sk-invalida-a-proposito',
  'x-ia-base-url': 'https://api.openai.com/v1/chat/completions',
  'x-ia-modelo': 'gpt-4o-mini',
});
check('la llamada sale y vuelve con ok:false', publico.status === 200 && publico.body.ok === false);
check(
  'y el motivo es del proveedor, no nuestro',
  !/interna|https/i.test(publico.body.error ?? ''),
  publico.body.error
);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
