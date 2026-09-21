// Verificacion de la importacion de un proyecto .eapx de Enterprise Architect.
// El archivo NO es sintetico: es el Diagramas.eapx generado por EA 15.0.1514.
import { readFileSync } from 'node:fs';

const API = 'http://localhost:4000';
const RUTA = process.env.EAPX ?? '/home/claude/Diagramas.eapx';

let ok = 0, fail = 0;
const check = (n, cond, d = '') => {
  if (cond) { ok++; console.log(`  OK   ${n}`); }
  else { fail++; console.log(`  FALLA ${n} ${d}`); }
};


/**
 * Desde que el sistema tiene autenticacion, /api exige token. Las pruebas se
 * registran como un usuario de verdad en vez de saltarse la seguridad: es la
 * unica forma de que prueben el camino que van a recorrer las personas.
 */
async function sesionDePrueba(nombre) {
  const correo = `prueba-${nombre}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@uagrm.edu.bo`;
  const r = await fetch(`${API}/api/auth/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ correo, nombre, password: 'contrasena-de-prueba-1' }),
  });
  if (!r.ok) throw new Error(`No se pudo registrar: ${r.status}`);
  return (await r.json()).token;
}
const TOKEN = await sesionDePrueba('pruebas');
const AUTH = { Authorization: `Bearer ${TOKEN}` };

async function subir(buf, nombre) {
  const fd = new FormData();
  fd.append('archivo', new Blob([buf]), nombre);
  const r = await fetch(`${API}/api/case/eapx`, { method: 'POST', body: fd, headers: AUTH });
  return { status: r.status, body: await r.json() };
}

console.log('=== 1) El servidor abre el .eapx de EA 15 ===');
const buf = readFileSync(RUTA);
const r = await subir(buf, 'Diagramas.eapx');
check('responde 200', r.status === 200, `=> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
check('reconoce la herramienta', r.body.herramienta === 'Enterprise Architect');
check('encuentra diagramas de clases', r.body.total >= 1, `=> ${r.body.total}`);

const diags = r.body.diagramas ?? [];
const conceptual = diags.find(d => d.nombre === 'Diseno Conceptual');
check('encuentra el "Diseno Conceptual"', Boolean(conceptual),
  `=> ${diags.map(d => d.nombre).join(' | ')}`);
check('el mas grande viene primero', diags[0]?.clases.length >= (diags[1]?.clases.length ?? 0));

console.log('\n=== 2) El contenido del diagrama es el correcto ===');
check('7 clases', conceptual?.clases.length === 7, `=> ${conceptual?.clases.length}`);
check('6 relaciones', conceptual?.conectores.length === 6, `=> ${conceptual?.conectores.length}`);
const nombres = (conceptual?.clases ?? []).map(c => c.nombre).sort();
check('los nombres son los del proyecto',
  nombres.join(',') === 'Categoria,DetalleRutina,Ejercicio,ImagenEjercicio,Rutina,Seguimiento,Usuario',
  `=> ${nombres.join(',')}`);
const usuario = conceptual?.clases.find(c => c.nombre === 'Usuario');
check('Usuario trae sus 13 atributos', usuario?.atributos.length === 13, `=> ${usuario?.atributos.length}`);
check('los atributos vienen en orden', usuario?.atributos[0]?.nombre === 'id',
  `=> ${usuario?.atributos[0]?.nombre}`);
check('trae el tipo y la visibilidad de EA',
  usuario?.atributos[0]?.tipo === 'int' && usuario?.atributos[0]?.visibilidad === 'Public',
  `=> ${usuario?.atributos[0]?.tipo} / ${usuario?.atributos[0]?.visibilidad}`);

console.log('\n=== 3) Posiciones y agregacion, tal como los guarda EA ===');
const cat = conceptual?.clases.find(c => c.nombre === 'Categoria');
// En EA el eje Y crece hacia arriba (RectTop negativo): el lector lo invierte.
check('la Y queda positiva hacia abajo', cat?.x === 660 && cat?.y === 60, `=> x=${cat?.x} y=${cat?.y}`);
const agg = conceptual?.conectores.find(c => c.tipo === 'Aggregation');
check('lee el conector de agregacion', Boolean(agg));
check('conserva DestIsAggregate = 2 (composicion)', agg?.aggDestino === 2, `=> ${agg?.aggDestino}`);
check('conserva las cardinalidades textuales de EA',
  agg?.cardOrigen === '1..*' && agg?.cardDestino === '1..1',
  `=> ${agg?.cardOrigen} / ${agg?.cardDestino}`);

console.log('\n=== 4) Solo relaciones de este diagrama ===');
for (const d of diags) {
  const ids = new Set(d.clases.map(c => c.id));
  const fuera = d.conectores.filter(c => !ids.has(c.origen) || !ids.has(c.destino));
  check(`"${d.nombre.slice(0, 34)}": sin relaciones a clases ajenas`, fuera.length === 0,
    `=> ${fuera.length}`);
}

console.log('\n=== 5) Archivos que no sirven dan un error claro, no un 500 ===');
const basura = await subir(Buffer.from('no soy una base de datos access'), 'roto.eapx');
check('un archivo cualquiera responde 400', basura.status === 400, `=> ${basura.status}`);
check('y explica el motivo', /no parece un|Access/i.test(basura.body.error ?? ''), basura.body.error);

const sinArchivo = await fetch(`${API}/api/case/eapx`, { method: 'POST', body: new FormData(), headers: AUTH });
check('sin archivo responde 400', sinArchivo.status === 400, `=> ${sinArchivo.status}`);

console.log('\n=== 6) Sin sesion no se puede subir un proyecto ===');
const anonimo = await fetch(`${API}/api/case/eapx`, { method: 'POST', body: new FormData() });
check('sin token responde 401', anonimo.status === 401, `=> ${anonimo.status}`);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
