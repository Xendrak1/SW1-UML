// Verificacion del adaptador de Enterprise Architect 15.
// Los datos NO son inventados: salen del Diagramas.eapx real que exporto
// Enterprise Architect 15.0.1514, leido con mdbtools y volcado al mismo JSON
// que produce SCRIPT_EXPORTAR_DESDE_EA.
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import {
  SCRIPT_EXPORTAR_DESDE_EA,
  exportarXmiEa,
  generarScriptDocumentacionEa,
  generarScriptEa,
  importarDumpEa,
} from '../src/utils/enterpriseArchitect';
import type { EdgeType, NodeType } from '../src/utils/umlConstants';

let ok = 0;
let fail = 0;
const check = (n: string, cond: boolean, d = '') => {
  if (cond) { ok += 1; console.log(`  OK   ${n}`); }
  else { fail += 1; console.log(`  FALLA ${n} ${d}`); }
};

const dump = readFileSync(`${import.meta.dirname}/dump-ea-real.json`, 'utf8');

console.log('=== 1) Importar el paquete real de EA ===');
const m = importarDumpEa(dump);
const porNombre = (l: string) => m.nodes.find(n => n.label === l);
const rel = (a: string, b: string) =>
  m.edges.find(e => porNombre(a)?.id === e.source && porNombre(b)?.id === e.target);

check('lee las 7 clases', m.nodes.length === 7, `=> ${m.nodes.length}`);
check('lee las 6 relaciones', m.edges.length === 6, `=> ${m.edges.length}`);
check('conserva los nombres', ['Usuario','Rutina','DetalleRutina','Ejercicio','Categoria','ImagenEjercicio','Seguimiento']
  .every(x => Boolean(porNombre(x))));
check('Usuario trae sus 13 atributos', (porNombre('Usuario')?.attributes ?? []).length === 13,
  `=> ${(porNombre('Usuario')?.attributes ?? []).length}`);
check('conserva la posicion del diagrama', porNombre('Categoria')?.x === 660 && porNombre('Categoria')?.y === 60,
  `=> x=${porNombre('Categoria')?.x} y=${porNombre('Categoria')?.y}`);

console.log('\n=== 2) Tipos y visibilidad de EA al modelo propio ===');
const attrsUsuario = porNombre('Usuario')?.attributes ?? [];
const attr = (n: string) => attrsUsuario.find(a => a.name === n);
check('"int" de EA se lee como Integer', attr('id')?.datatype === 'Integer', `=> ${attr('id')?.datatype}`);
check('"string" de EA se lee como String', attr('nombre')?.datatype === 'String', `=> ${attr('nombre')?.datatype}`);
check('no inventa datatypes fuera del dominio',
  m.nodes.every(n => (n.attributes ?? []).every(a => ['String','Integer','Float','Boolean','Date'].includes(a.datatype))));
check('"Public" de EA se lee como public', attr('id')?.scope === 'public', `=> ${attr('id')?.scope}`);

console.log('\n=== 3) La direccion de la composicion (el punto delicado) ===');
// En el .eapx real: Aggregation DetalleRutina -> Rutina con DestIsAggregate = 2.
// El rombo esta en Rutina, que es el TODO. En el modelo propio el todo va en
// source, asi que la arista tiene que quedar Rutina -> DetalleRutina.
const comp = m.edges.find(e => e.tipo === 'composicion');
check('la reconoce como composicion', Boolean(comp));
check('el todo (Rutina) queda en source', porNombre('Rutina')?.id === comp?.source,
  `=> source=${m.nodes.find(n => n.id === comp?.source)?.label}`);
check('la parte (DetalleRutina) queda en target', porNombre('DetalleRutina')?.id === comp?.target,
  `=> target=${m.nodes.find(n => n.id === comp?.target)?.label}`);
check('invierte tambien las multiplicidades',
  comp?.multiplicidadOrigen === '1' && comp?.multiplicidadDestino === '*',
  `=> ${comp?.multiplicidadOrigen}:${comp?.multiplicidadDestino}`);

console.log('\n=== 4) Multiplicidades "1..1" / "0..*" ===');
const ur = rel('Usuario', 'Rutina');
check('Usuario 1 -> * Rutina', ur?.multiplicidadOrigen === '1' && ur?.multiplicidadDestino === '*',
  `=> ${ur?.multiplicidadOrigen}:${ur?.multiplicidadDestino}`);
const ds = rel('DetalleRutina', 'Seguimiento');
check('"0..1" se lee como 1, no como *', ds?.multiplicidadDestino === '1', `=> ${ds?.multiplicidadDestino}`);

console.log('\n=== 5) Ida y vuelta: modelo -> script de EA -> modelo ===');
const script = generarScriptEa(m, { paquete: 'Modelo de Datos', diagrama: 'Diseno Conceptual' });

// Se evaluan los literales que el script le pasa a EA: es la forma de comprobar
// que lo que va a leer EA es exactamente el modelo, sin tener EA a mano.
function leerArreglo(nombre: string): unknown[] {
  const re = new RegExp(`var ${nombre} = (\\[[\\s\\S]*?\\n\\]);`, 'm');
  const cap = re.exec(script);
  if (!cap) throw new Error(`el script no declara ${nombre}`);
  return new Function(`return ${cap[1]}`)() as unknown[];
}
type ClaseJs = { clave: string; nombre: string; asociativa: boolean; rect: string; atributos: Array<{ nombre: string; tipo: string; vis: string }> };
type ConJs = { tipo: string; origen: string; destino: string; cardOrigen: string; cardDestino: string; agg: number };
const clasesJs = leerArreglo('CLASES') as ClaseJs[];
const consJs = leerArreglo('CONECTORES') as ConJs[];

check('emite las 7 clases', clasesJs.length === 7, `=> ${clasesJs.length}`);
check('emite las 6 relaciones', consJs.length === 6, `=> ${consJs.length}`);
check('emite los atributos con el tipo de EA',
  clasesJs.find(c => c.nombre === 'Usuario')?.atributos.some(a => a.nombre === 'id' && a.tipo === 'int') === true);
check('emite la visibilidad en el formato de EA',
  clasesJs.every(c => c.atributos.every(a => ['Public','Private','Protected'].includes(a.vis))));

const compJs = consJs.find(c => c.agg === 2);
const claveDe = (l: string) => clasesJs.find(c => c.nombre === l)?.clave;
check('la composicion vuelve a salir como Aggregation', compJs?.tipo === 'Aggregation');
check('con el conector arrancando en la parte', compJs?.origen === claveDe('DetalleRutina'),
  `=> ${compJs?.origen} vs ${claveDe('DetalleRutina')}`);
check('y el rombo en el extremo del todo', compJs?.destino === claveDe('Rutina'));
// En una composicion la parte no existe sin el todo, asi que el minimo del
// lado de la parte es 1: "1..*". Por eso este extremo vuelve a EA identico a
// como estaba.
check('la composicion recupera las cardinalidades exactas de EA',
  compJs?.cardOrigen === '1..*' && compJs?.cardDestino === '1..1',
  `=> ${compJs?.cardOrigen} / ${compJs?.cardDestino}`);
// En una asociacion comun el limite inferior no se guarda en el modelo: un
// "1..*" de EA vuelve como "0..*". Es la unica perdida del ciclo y esta
// documentada en el script que se genera.
const asoJs = consJs.find(c => c.origen === claveDe('Usuario') && c.destino === claveDe('Rutina'));
check('la asociacion comun emite el limite inferior permisivo',
  asoJs?.cardOrigen === '1..1' && asoJs?.cardDestino === '0..*',
  `=> ${asoJs?.cardOrigen} / ${asoJs?.cardDestino}`);
check('el script avisa de esa perdida', /no lo puede saber/.test(script));

// El eje Y de EA crece hacia arriba: una clase en y=60 del lienzo tiene que
// salir con t=-60, no con t=60. Si no, el diagrama sale espejado.
const rectCat = clasesJs.find(c => c.nombre === 'Categoria')?.rect ?? '';
check('niega la Y para el sistema de coordenadas de EA', /l=660;r=880;t=-60;b=-/.test(rectCat), `=> ${rectCat}`);

console.log('\n=== 6) Los scripts son JScript valido ===');
// El motor de EA es JScript 5.8: no acepta let, const, arrow functions,
// template literals ni for..of, y NO tiene el objeto JSON.
const scripts: Array<[string, string]> = [
  ['script del modelo', script],
  ['script de la documentacion', generarScriptDocumentacionEa(m, { sistema: 'Herramienta CASE' })],
  ['script de exportacion desde EA', SCRIPT_EXPORTAR_DESDE_EA],
];
for (const [nombre, s] of scripts) {
  // La primera linea es la directiva !INC de EA, que no es JavaScript.
  const cuerpo = s.split('\n').filter(l => !l.startsWith('!INC')).join('\n');
  let sintaxis = true;
  try { new Function(cuerpo.replace(/\bmain\(\);\s*$/, '')); } catch (err) {
    sintaxis = false;
    console.log(`       ${err instanceof Error ? err.message : err}`);
  }
  check(`${nombre}: sintaxis valida`, sintaxis);
  check(`${nombre}: sin ES6 que JScript no entiende`,
    !/\b(let|const)\s|=>|`|\bfor\s*\(\s*var?\s*\w+\s+of\b/.test(cuerpo),
    `=> ${/\b(let|const)\s/.exec(cuerpo)?.[0] ?? /=>/.exec(cuerpo)?.[0] ?? '`'}`);
  check(`${nombre}: no usa el objeto JSON`, !/\bJSON\s*\.\s*(parse|stringify)\b/.test(cuerpo));
  check(`${nombre}: declara main() y lo llama`, /function main\(\)/.test(cuerpo) && /\nmain\(\);/.test(cuerpo));
}

console.log('\n=== 7) El script de documentacion arma el arbol del documento ===');
const doc = generarScriptDocumentacionEa(m, { sistema: 'Herramienta CASE Colaborativa' });
for (const p of ['1. Requisitos','Casos de Uso','Diagrama General','2. Analisis','3. Diseno',
                 '3.1 Arquitectura Logica','3.2 Modelo de Datos','3.4 Clases Dinamicas','3.5 Secuencia']) {
  check(`crea el paquete "${p}"`, doc.includes(`"${p}"`));
}
for (const t of ['"Use Case"','"Logical"','"Sequence"','"Package"']) {
  check(`usa diagramas ${t}`, doc.includes(t));
}
check('un caso de uso por clase normal (7 clases, ninguna asociativa)',
  (doc.match(/\{codigo:"CU/g) ?? []).length === 7,
  `=> ${(doc.match(/\{codigo:"CU/g) ?? []).length}`);
check('las clases dinamicas llevan estereotipo boundary/control/entity',
  doc.includes('"boundary"') && doc.includes('"control"') && doc.includes('"entity"'));
check('los mensajes de secuencia van numerados', doc.includes('c.SequenceNo = i + 1'));
check('el modelo conceptual va dentro del script de documentacion',
  doc.includes('var CLASES = [') && doc.includes('"Usuario"'));
// El diagrama general tiene que MOSTRAR los casos de uso del paquete "Casos de
// Uso", no crear otra copia: EA los listaria dos veces en la documentacion.
check('el diagrama general reusa los casos de uso en vez de duplicarlos',
  doc.includes('existente(pkgCu, CASOS[i].nombre)'));
// Los actores tambien se reusan del paquete "Casos de Uso": se buscan por el
// nombre que trae cada caso de uso, no se crean de nuevo.
check('y reusa los actores en vez de duplicarlos', doc.includes('var a = existente(pkgCu, nom);'));

console.log('\n=== 8) Casos borde ===');
let tiro = false;
try { importarDumpEa('{"clases":[]}'); } catch { tiro = true; }
check('un paquete sin clases da un error claro', tiro);
tiro = false;
try { importarDumpEa('no soy json'); } catch (e) { tiro = /JSON valido/.test(String(e)); }
check('un archivo que no es JSON da un error claro', tiro);

// Una relacion a una clase de otro paquete no puede dibujarse.
const suelto = JSON.parse(dump) as { clases: unknown[]; conectores: Array<Record<string, unknown>> };
suelto.conectores.push({ guid: '{X}', tipo: 'Association', origen: '999', destino: '998', cardOrigen: '1..1', cardDestino: '0..*', aggOrigen: 0, aggDestino: 0 });
check('descarta relaciones a clases que no estan en el paquete',
  importarDumpEa(JSON.stringify(suelto)).edges.length === 6);

const sinPos = JSON.parse(dump) as { clases: Array<Record<string, unknown>> };
sinPos.clases.forEach(c => { delete c.x; delete c.y; });
const auto = importarDumpEa(JSON.stringify(sinPos));
check('acomoda en grilla las clases sin posicion',
  auto.nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y)) &&
  new Set(auto.nodes.map(n => `${n.x},${n.y}`)).size === auto.nodes.length);

// Un modelo con clase asociativa, que es lo que genera la IA.
const nodos: NodeType[] = [
  { id: 'a', label: 'Pedido', x: 0, y: 0, attributes: [{ name: 'fecha', datatype: 'Date', scope: 'private' }] },
  { id: 'b', label: 'Producto', x: 300, y: 0, attributes: [] },
  { id: 'c', label: 'DetallePedido', x: 150, y: 250, attributes: [], asociativa: true, relaciona: ['a', 'b'] },
];
const aristas: EdgeType[] = [
  { id: 'e1', source: 'a', target: 'c', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'e2', source: 'b', target: 'c', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'e3', source: 'a', target: 'b', tipo: 'herencia', multiplicidadOrigen: '1', multiplicidadDestino: '1' },
];
const s2 = generarScriptEa({ nodes: nodos, edges: aristas });
check('marca la clase asociativa con un estereotipo', /nombre:"DetallePedido",asociativa:true/.test(s2));
check('la herencia sale como Generalization', /tipo:"Generalization"/.test(s2));
check('una clase sin atributos no rompe el script', /nombre:"Producto".*atributos:\[\]/.test(s2));

console.log('\n=== 9) Exportacion en XMI 2.1 para el menu de EA ===');
const xmi = exportarXmiEa(m, 'Modelo de Datos');
check('declara xmi:version 2.1', xmi.includes('xmi:version="2.1"'));
check('usa los namespaces de EA (schema.omg.org)',
  xmi.includes('http://schema.omg.org/spec/UML/2.1') && xmi.includes('http://schema.omg.org/spec/XMI/2.1'));
check('las clases van dentro de un uml:Package', /<packagedElement xmi:type="uml:Package"[\s\S]*<packagedElement xmi:type="uml:Class"/.test(xmi));
check('emite las 7 clases', (xmi.match(/xmi:type="uml:Class"/g) ?? []).length === 7,
  `=> ${(xmi.match(/xmi:type="uml:Class"/g) ?? []).length}`);
check('emite los atributos con el tipo de EA', xmi.includes('<type xmi:idref="EAJava_int"/>'));
// 6 relaciones, todas asociaciones o agregaciones, por 2 extremos cada una.
const asociaciones = m.edges.filter(e => e.tipo !== 'herencia' && e.tipo !== 'dependencia').length;
check('cada asociacion declara sus dos memberEnd',
  (xmi.match(/<memberEnd /g) ?? []).length === asociaciones * 2,
  `=> ${(xmi.match(/<memberEnd /g) ?? []).length} para ${asociaciones} asociaciones`);
// El rombo va en el extremo del TODO, que en este modelo es el source.
const bloqueComp = /<packagedElement xmi:type="uml:Association"[^>]*>([\s\S]*?)<\/packagedElement>/g;
let hayCompuesta = false;
let mm: RegExpExecArray | null;
while ((mm = bloqueComp.exec(xmi)) !== null) {
  if (!mm[1].includes('aggregation="composite"')) continue;
  hayCompuesta = true;
  const src = /_SRC"[^>]*aggregation="composite">\s*<type xmi:idref="([^"]+)"/.exec(mm[1]);
  const idRutina = `EAID_CL${m.nodes.findIndex(n => n.label === 'Rutina') + 1}`;
  check('el rombo queda del lado del todo (Rutina)', src?.[1] === idRutina, `=> ${src?.[1]} vs ${idRutina}`);
  check('el lado de la parte lleva minimo 1 (1..*)', /_DST"[\s\S]*?LiteralInteger" value="1"/.test(mm[1]));
}
check('hay una asociacion compuesta', hayCompuesta);
check('el limite superior "muchos" va como -1 (UnlimitedNatural)',
  xmi.includes('<upperValue xmi:type="uml:LiteralUnlimitedNatural" value="-1"/>'));
check('no emite la herencia como elemento suelto',
  !/<packagedElement xmi:type="uml:Generalization"/.test(xmi));

// Se deja el archivo para validarlo con un parser XML de verdad.
writeFileSync(`${import.meta.dirname}/salida-xmi21.xml`, xmi);

console.log('\n=== 10) Actores y diagramas de arquitectura del enunciado ===');
const doc2 = generarScriptDocumentacionEa(m, {
  sistema: 'Herramienta CASE',
  actor: 'Colaborador',
  casosDeUso: [
    { codigo: 'CU1', nombre: 'Iniciar Sesion', entidad: 'Rutina', actor: 'Anfitrion' },
    { codigo: 'CU2', nombre: 'Elaborar el Diagrama', entidad: 'Rutina', actor: 'Ingeniero de Datos' },
    { codigo: 'CU3', nombre: 'Probar la API', entidad: 'Rutina', actor: 'Ingeniero de Pruebas' },
  ],
});
check('cada caso de uso lleva su propio actor',
  doc2.includes('actor:"Anfitrion"') && doc2.includes('actor:"Ingeniero de Datos"') &&
  doc2.includes('actor:"Ingeniero de Pruebas"'));
check('el diagrama general reparte por actor', doc2.includes('conectar(actores[CASOS[i].actor]'));
check('no cuelga un actor generico de todos los CU', !doc2.includes('conectar(actGen, ucG'));

for (const p of ['3.1.1 Diseno Fisico', '4. Implementacion']) {
  check(`crea el paquete "${p}"`, doc2.includes(`"${p}"`));
}
check('genera el diagrama de despliegue', doc2.includes('"Deployment"') && doc2.includes('function despliegue('));
check('genera el de componentes', doc2.includes('"Component"') && doc2.includes('function componentes('));
check('genera el de capas', doc2.includes('function capas('));
check('el despliegue nombra los protocolos reales',
  doc2.includes('"TCP 5432"') && doc2.includes('"HTTP 11434"') && doc2.includes('"HTTPS / WSS"'));
check('el despliegue incluye el celular con la IA on-device',
  doc2.includes('"Interprete de IA On-Device"'));
check('anida los componentes dentro de los nodos con ParentID',
  doc2.includes('el.ParentID = padre.ElementID'));
check('las capas dependen hacia abajo', /for \(i = 0; i < deCapa\.length - 1; i\+\+\)/.test(doc2));
check('los nodos llevan estereotipo device/node',
  doc2.includes('est:"device"') && doc2.includes('est:"node"'));

console.log('\n=== 11) El modelo tiene los diagramas que el documento promete ===');
const doc3 = generarScriptDocumentacionEa(m, {
  sistema: 'Herramienta CASE',
  casosDeUso: [
    { codigo: 'CU01', nombre: 'Crear pizarra', actor: 'Anfitrion', conSecuencia: true, conClasesDinamicas: false },
    { codigo: 'CU02', nombre: 'Compartir enlace', actor: 'Anfitrion', conSecuencia: false, conClasesDinamicas: false },
    { codigo: 'CU08', nombre: 'Instruccion escrita', actor: 'Ingeniero de Datos', conSecuencia: false, conClasesDinamicas: true },
  ],
  ciclos: [{ nombre: 'Ciclo 1', casos: ['CU01', 'CU02'] }],
});
check('cada caso de uso lleva sus dos banderas',
  /seq:true,din:false/.test(doc3) && /seq:false,din:true/.test(doc3));
check('la secuencia solo se genera si el caso la pide', doc3.includes('if (CASOS[i].seq)'));
check('las clases dinamicas tambien', doc3.includes('if (CASOS[i].din)'));
check('declara los ciclos', doc3.includes('var CICLOS = [') && doc3.includes('"Ciclo 1"'));
check('genera un diagrama por iteracion', doc3.includes('var diaCi = diagrama(pkgGen, ci.nombre, "Use Case")'));
check('los diagramas por iteracion reusan los casos de uso ya creados',
  doc3.includes('var ucC = existente(pkgCu, CASOS[j].nombre)'));
// Sin ciclos declarados no debe romperse: el bucle simplemente no corre.
const doc4 = generarScriptDocumentacionEa(m, { sistema: 'X' });
check('sin ciclos no se rompe', doc4.includes('var CICLOS = [\n];') || doc4.includes('var CICLOS = ['));

console.log('\n=== 12) Dos actores con herencia, no cinco en paralelo ===');
const doc5 = generarScriptDocumentacionEa(m, {
  sistema: 'Herramienta CASE',
  actor: 'Modelador participante',
  casosDeUso: [
    { codigo: 'CU01', nombre: 'Crear pizarra', actor: 'Modelador anfitrion', conSecuencia: false, conClasesDinamicas: false },
    { codigo: 'CU05', nombre: 'Editar clases', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  ],
  herenciaActores: [['Modelador anfitrion', 'Modelador participante']],
});
check('declara la herencia entre actores', doc5.includes('var HERENCIA_ACTORES = ['));
check('con el hijo y el padre correctos',
  doc5.includes('{hijo:"Modelador anfitrion",padre:"Modelador participante"}'));
check('la dibuja como Generalization',
  doc5.includes('conectar(hijo, padre, "Generalization", "", "", 0, "")'));
check('solo aparecen los dos actores',
  (doc5.match(/actor:"Modelador (anfitrion|participante)"/g) ?? []).length === 2);
check('ningun caso de uso tiene dos actores a la vez', !/actor:"[^"]*,[^"]*"/.test(doc5));
// Sin herencia declarada el bucle no debe romper nada.
const doc6 = generarScriptDocumentacionEa(m, { sistema: 'X' });
check('sin herencia declarada no se rompe', doc6.includes('var HERENCIA_ACTORES = ['));

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
