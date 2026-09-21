// Verificacion del modo dominio de la IA. El caso que lo motivo: "crea la base
// de datos de una cafeteria tipo Starbucks" devolvia una sola clase Cliente.
// Corre contra mock-ollama.mjs, no contra el modelo real.
const API='http://localhost:4000', MOCK='http://127.0.0.1:11434';
const set = e => fetch(`${MOCK}/_set/${e}`).then(r=>r.text());
const last = () => fetch(`${MOCK}/_last`).then(r=>r.json());

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

const pedir = (prompt, classes=[], relations=[]) =>
  fetch(`${API}/api/ai/uml-actions`,{method:'POST',headers:{'Content-Type':'application/json',...AUTH},
    body:JSON.stringify({prompt,classes,relations})}).then(async r=>({status:r.status, body:await r.json()}));

let ok=0, fail=0;
const check = (n, cond, d='') => { if (cond) { ok++; console.log(`  OK   ${n}`); } else { fail++; console.log(`  FALLA ${n} ${d}`); } };

console.log('=== 1) Clasificacion del modo ===');
const DOMINIO = [
  'crea la base de datos de una cafeteria tipo Starbucks',
  'modela el sistema de una veterinaria',
  'disena la bd para un restaurante',
  'hazme el modelo de una biblioteca',
  'diagrama completo del sistema de un hotel',
  'modelar la base de datos de una farmacia',
  'quiero al menos 10 tablas para una cafeteria',
  'hazme 12 clases',
];
const ATOMICAS = [
  'agrega un atributo precio a la clase Producto de la tienda',
  'crea una clase Cliente con nombre y telefono',
  'Auto hereda de Vehiculo',
  'relacion entre Pedido y Cliente',
  'elimina la clase Factura',
  'renombra Mascota a Paciente',
  'agrega el campo stock al inventario',
  'cambiale el tipo a fecha',
];
await set('dominio');
for (const p of DOMINIO) {
  const r = await pedir(p);
  check(`dominio: "${p.slice(0,36)}"`, r.body.modo === 'dominio', `=> ${r.body.modo}`);
}
await set('ok');
for (const p of ATOMICAS) {
  const r = await pedir(p);
  check(`atomico: "${p.slice(0,36)}"`, r.body.modo === 'atomico', `=> ${r.body.modo}`);
}

console.log('\n=== 2) Se pide en dos etapas, no en un JSON gigante ===');
await set('dominio');
let r = await pedir('crea la base de datos de una cafeteria tipo Starbucks');
let { llamadas } = await last();
check('hace dos llamadas al modelo', llamadas === 2, `=> ${llamadas}`);
const { ultimaPeticion: p2 } = await last();
check('la ultima etapa pide relaciones', p2.messages[0].content.includes('devuelves las relaciones'));
check('la etapa 2 recibe la lista cerrada de clases', p2.messages[1].content.includes('CLASES NORMALES:'));
check('la etapa 2 conoce las asociativas y que unen', p2.messages[1].content.includes('DetallePedido (une Pedido y Producto)'));
check('num_ctx ampliado', p2.options?.num_ctx >= 12288, `=> ${p2.options?.num_ctx}`);
check('num_predict definido', p2.options?.num_predict >= 2048, `=> ${p2.options?.num_predict}`);
check('informa las etapas', Array.isArray(r.body.etapas) && r.body.etapas.length >= 2, JSON.stringify(r.body.etapas));

console.log('\n=== 3) El modelo de Starbucks llega completo ===');
const clases = r.body.actions.filter(a=>a.target==='class' && a.type==='create');
const nombres = clases.map(a=>a.data.label).sort();
const aristas = r.body.actions.filter(a=>a.target==='edge');
check('mas de una clase (el bug original)', clases.length > 1, `=> ${clases.length}`);
check('al menos 8 clases', clases.length >= 8, `=> ${clases.length} (${nombres.join(', ')})`);
check('incluye Producto y Pedido', nombres.includes('Producto') && nombres.includes('Pedido'));
check('resuelve M:N con DetallePedido', clases.some(a=>a.data.label==='DetallePedido' && a.data.asociativa===true));
check('resuelve M:N con Receta', clases.some(a=>a.data.label==='Receta' && a.data.asociativa===true));
check('cada clase trae atributos', clases.every(a=>(a.data.attributes??[]).length>0),
      `=> sin atributos: ${clases.filter(a=>(a.data.attributes??[]).length===0).map(a=>a.data.label)}`);
check('no hay atributos id', !clases.some(a=>(a.data.attributes??[]).some(x=>x.name==='id')));
check('no hay claves ajenas como atributo', !clases.some(a=>(a.data.attributes??[]).some(x=>/Id$/.test(x.name))));
check('hay relaciones', aristas.length >= 8, `=> ${aristas.length}`);
check('ninguna arista *:*', !aristas.some(a=>a.data.multiplicidadOrigen==='*' && a.data.multiplicidadDestino==='*'));
check('descarta la relacion a una clase inexistente',
      !aristas.some(a=>a.data.targetLabel==='Sucursal' || a.data.sourceLabel==='Sucursal'));
check('lo reporta en las etapas', r.body.etapas.some(e=>e.startsWith('relaciones_fuera_de_lista')),
      JSON.stringify(r.body.etapas));

const tocadas = new Set();
for (const a of aristas) { tocadas.add(a.data.sourceLabel); tocadas.add(a.data.targetLabel); }
const sueltas = clases.filter(c=>!tocadas.has(c.data.label)).map(c=>c.data.label);
check('ninguna clase queda suelta', sueltas.length === 0, `=> sueltas: ${sueltas.join(', ')}`);

console.log('\n=== 4) Orden de aplicacion ===');
const ultimaNormal = r.body.actions.reduce((m,a,i)=> (a.target==='class'&&!a.data.asociativa? i:m), -1);
const primeraAsoc = r.body.actions.findIndex(a=>a.target==='class'&&a.data.asociativa===true);
const primerEdge = r.body.actions.findIndex(a=>a.target==='edge');
check('clases normales antes que las asociativas', ultimaNormal < primeraAsoc, `${ultimaNormal} < ${primeraAsoc}`);
check('clases antes que las relaciones', primeraAsoc < primerEdge, `${primeraAsoc} < ${primerEdge}`);

console.log('\n=== 5) Cuando el modelo se queda corto, se le pide lo que falta ===');
await set('dominio_corto');
r = await pedir('quiero al menos 9 tablas para una cafeteria');
const c2 = r.body.actions.filter(a=>a.target==='class');
check('completa hasta el minimo pedido', c2.length >= 9, `=> ${c2.length}`);
check('no repite clases', new Set(c2.map(a=>a.data.label)).size === c2.length);
check('informa el completado', r.body.etapas.some(e=>e.startsWith('completadas=')), JSON.stringify(r.body.etapas));
({ llamadas } = await last());
check('gasta una llamada extra, no mas', llamadas === 3, `=> ${llamadas}`);

console.log('\n=== 6) Si la etapa de relaciones falla, no se pierde el modelo ===');
await set('relaciones_roto');
r = await pedir('modela el sistema de una cafeteria');
check('la peticion no falla', r.status === 200, `=> ${r.status}`);
check('devuelve las clases igual', r.body.actions.filter(a=>a.target==='class').length >= 8);
check('lo deja anotado', r.body.etapas.some(e=>e==='relaciones=fallo'||e==='relaciones=0'),
      JSON.stringify(r.body.etapas));

console.log('\n=== 7) Rescate de una etapa truncada ===');
await set('truncado');
r = await pedir('modela el sistema de una biblioteca');
check('la peticion no falla', r.status === 200, `=> ${r.status}`);
check('marca la respuesta como rescatada', r.body.rescatado === true);
check('recupera las clases completas', r.body.actions.filter(a=>a.target==='class').length === 3,
      `=> ${r.body.actions.filter(a=>a.target==='class').length}`);
check('descarta la clase cortada', !r.body.actions.some(a=>a.data.label?.startsWith('Prest')));

console.log('\n=== 8) No rompe lo que ya funcionaba ===');
await set('ok');
r = await pedir('crea una clase Mascota con nombre texto');
check('modo atomico sigue respondiendo', r.body.actions?.[0]?.data?.label === 'Mascota');
const { ultimaPeticion: pa, llamadas: la } = await last();
check('una sola llamada en modo atomico', la === 1, `=> ${la}`);
check('num_ctx por defecto en modo atomico', pa.options?.num_ctx === 8192, `=> ${pa.options?.num_ctx}`);

console.log('\n=== 9) Modelo de IA no descargado (el error de la foto) ===');
await set('modelo_inexistente');
const fd = new FormData();
fd.append('image', new Blob([Buffer.from('89504e470d0a1a0a','hex')], {type:'image/png'}), 'd.png');
const img = await fetch(`${API}/api/ai/image-to-uml`, {method:'POST', body:fd, headers:AUTH})
  .then(async r=>({status:r.status, body:await r.json()}));
check('no responde 500 generico', img.status === 503, `=> ${img.status}`);
check('nombra el modelo que falta', typeof img.body.modelo === 'string' && img.body.modelo.length>0,
      `=> ${JSON.stringify(img.body.modelo)}`);
check('da el comando exacto', String(img.body.remedio ?? '').startsWith('ollama pull '),
      `=> ${JSON.stringify(img.body.remedio)}`);
check('el mensaje explica que hacer', /ollama pull/.test(img.body.error ?? ''));
check('menciona OLLAMA_VISION_MODEL', /OLLAMA_VISION_MODEL/.test(img.body.error ?? ''));
check('no dice "no hay OPENAI_API_KEY" como causa principal',
      !/^La IA local fallo/.test(img.body.error ?? ''));

let st = await fetch(`${API}/api/ai/status`, {headers:AUTH}).then(r=>r.json());
check('el estado lista los modelos descargados', Array.isArray(st.local.instalados), JSON.stringify(st.local.instalados));
check('con los dos bajados marca los dos', st.local.modelInstalado === true && st.local.visionModelInstalado === true);

// El caso de Eduardo: tiene el de texto y NO el de vision.
await fetch(`${MOCK}/_tags/qwen2.5:7b-instruct`);
st = await fetch(`${API}/api/ai/status`, {headers:AUTH}).then(r=>r.json());
check('detecta que falta el de vision', st.local.visionModelInstalado === false,
      `vision=${st.local.visionModel} instalados=${JSON.stringify(st.local.instalados)}`);
check('y que el de texto si esta', st.local.modelInstalado === true);
await fetch(`${MOCK}/_tags/qwen2.5:7b-instruct,llama3.2-vision:11b`);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok+fail} ===`);
process.exit(fail === 0 ? 0 : 1);
