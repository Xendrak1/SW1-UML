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
const check = (nombre, cond, detalle='') => {
  if (cond) { ok++; console.log(`  OK   ${nombre}`); }
  else { fail++; console.log(`  FALLA ${nombre} ${detalle}`); }
};

console.log('=== 1) Contrato de la peticion a Ollama ===');
await set('ok');
await pedir('crea una clase Mascota con nombre texto y edad entero');
const { ultimaPeticion: p } = await last();
check('envia model', p.model === 'qwen2.5:7b-instruct');
check('stream en false', p.stream === false);
check('format json', p.format === 'json');
check('temperatura baja', p.options?.temperature <= 0.2, `(${p.options?.temperature})`);
check('mensaje system + user', p.messages?.length === 2 && p.messages[0].role==='system' && p.messages[1].role==='user');
check('el system lleva ejemplos', p.messages[0].content.includes('## EJEMPLOS'));
check('el user lleva el diagrama actual', p.messages[1].content.includes('DIAGRAMA ACTUAL'));
check('avisa que el diagrama esta vacio', p.messages[1].content.includes('el diagrama esta vacio'));
check('el user lleva la instruccion', p.messages[1].content.includes('crea una clase Mascota'));

console.log('\n=== 2) Formatos de respuesta que da un modelo chico ===');
for (const [esc, esperado] of [['ok','Mascota'],['markdown','Dueno'],['prosa','Consulta'],['array','Veterinario']]) {
  await set(esc);
  const r = await pedir('crea la clase');
  check(`${esc}: extrae la accion`, r.body.actions?.[0]?.data?.label === esperado,
        `=> ${JSON.stringify(r.body.actions?.[0]?.data?.label)}`);
}

console.log('\n=== 3) Normalizacion de valores fuera del dominio ===');
await set('sucio');
let r = await pedir('crea Factura');
const cls = r.body.actions.find(a=>a.target==='class');
const edge = r.body.actions.find(a=>a.target==='edge');
check('descarta el atributo id implicito', !cls.data.attributes.some(a=>a.name==='id'));
check('descarta el atributo sin nombre', !cls.data.attributes.some(a=>!a.name));
check('descarta el atributo duplicado', cls.data.attributes.filter(a=>a.name==='total').length===1);
check('normaliza decimal a Float', cls.data.attributes.find(a=>a.name==='total')?.datatype==='Float');
check('normaliza datetime a Date', cls.data.attributes.find(a=>a.name==='fecha')?.datatype==='Date');
check('normaliza el scope +', cls.data.attributes.find(a=>a.name==='total')?.scope==='public');
check('normaliza "Association" a asociacion', edge.data.tipo==='asociacion');
check('normaliza 0..* a *', edge.data.multiplicidadDestino==='*');
check('reporta lo degradado', Array.isArray(r.body.descartadas) && r.body.descartadas.length>0,
      `descartadas=${JSON.stringify(r.body.descartadas)}`);

console.log('\n=== 4) Reglas de dominio UML ===');
await set('mn_directo');
r = await pedir('muchos a muchos entre Medico y Paciente');
check('degrada *:* a 1:*', r.body.actions[0].data.multiplicidadOrigen==='1' && r.body.actions[0].data.multiplicidadDestino==='*');
check('informa la degradacion', r.body.descartadas.some(d=>d.includes('muchos a muchos')));

await set('mn_bien');
r = await pedir('muchos a muchos entre Medico y Paciente');
check('acepta la clase asociativa', r.body.actions.some(a=>a.data.asociativa===true));
check('conserva sus dos extremos', r.body.actions.find(a=>a.data.asociativa)?.data.relaciona?.length===2);
check('genera las dos relaciones', r.body.actions.filter(a=>a.target==='edge').length===2);

await set('asociativa_incompleta');
r = await pedir('crea una intermedia');
check('asociativa incompleta pasa a clase normal', r.body.actions[0]?.data.asociativa===false);

await set('herencia_con_mult');
r = await pedir('Auto hereda de Vehiculo');
check('la herencia queda en 1:1', r.body.actions[0].data.multiplicidadOrigen==='1' && r.body.actions[0].data.multiplicidadDestino==='1');

await set('orden_invertido');
r = await pedir('crea Pedido y Detalle relacionados');
const tipos = r.body.actions.map(a=>`${a.type}:${a.target}`);
check('reordena: clases antes que aristas', tipos.indexOf('create:edge') === tipos.length-1, JSON.stringify(tipos));

await set('inventado');
r = await pedir('refactoriza todo');
check('descarta acciones inexistentes', r.body.actions.length===1 && r.body.actions[0].data.label==='Valida');
check('explica por que las descarto', r.body.descartadas.length===2, JSON.stringify(r.body.descartadas));

await set('vacio');
r = await pedir('gracias');
check('instruccion sin cambios devuelve vacio', Array.isArray(r.body.actions) && r.body.actions.length===0);

console.log('\n=== 5) Recuperacion ante respuestas mal formadas ===');
await set('roto');
r = await pedir('hace algo raro');
check('repara y responde 200', r.status===200, `status=${r.status}`);
check('marca que fue reparada', r.body.reparado===true);
const l = await last();
check('la reparacion costo una segunda llamada', l.llamadas===2, `llamadas=${l.llamadas}`);

await set('roto_total');
r = await pedir('hace algo raro');
check('si la reparacion falla devuelve error claro', r.status===500 && /JSON/i.test(r.body.error||''), `${r.status} ${r.body.error}`);

await set('vacia_total');
r = await pedir('hola');
check('respuesta vacia da error claro', r.status===500 && /vacia/i.test(r.body.error||''), `${r.status} ${r.body.error}`);

console.log('\n=== 6) Modelo no descargado (el error mas probable en su maquina) ===');
await set('modelo_inexistente');
r = await pedir('crea una clase');
// 503 y no 500: no es un fallo del servidor, es algo que el usuario resuelve
// con un comando. El mensaje tiene que traerlo.
check('devuelve 503, no un 500 generico', r.status===503, `=> ${r.status}`);
check('el mensaje nombra el modelo faltante', /qwen2\.5/.test(r.body.error||''), r.body.error);
check('trae el comando para resolverlo', /ollama pull/.test(r.body.error||''), r.body.error);
check('trae el remedio en un campo aparte', String(r.body.remedio||'').startsWith('ollama pull '), r.body.remedio);

console.log('\n=== 7) Guia de usuario ===');
await set('ask');
r = await fetch(`${API}/api/ai/ask`,{method:'POST',headers:{'Content-Type':'application/json',...AUTH},
  body:JSON.stringify({question:'como genero el backend',context:'P: como genero el backend\nR: menu Generar.'})}).then(async x=>({status:x.status,body:await x.json()}));
check('responde texto', typeof r.body.answer==='string' && r.body.answer.length>20, r.body.answer);

console.log('\n=== 8) Reconocimiento de imagen ===');
await set('imagen');
const form = new FormData();
form.append('image', new Blob([Buffer.from('fake-png')],{type:'image/png'}), 'd.png');
r = await fetch(`${API}/api/ai/image-to-uml`,{method:'POST',body:form,headers:AUTH}).then(async x=>({status:x.status,body:await x.json()}));
check('reconoce las clases validas', r.body.classes?.length===2, JSON.stringify(r.body.classes?.map(c=>c.label)));
check('descarta la clase duplicada y la sin nombre', r.body.descartadas.some(d=>d.includes('duplicada')));
check('normaliza "rombo lleno" a composicion', r.body.relations[0]?.tipo==='composicion');
check('normaliza la multiplicidad n a *', r.body.relations[0]?.multiplicidadDestino==='*');
check('descarta relacion a clase inexistente', r.body.descartadas.some(d=>d.includes('inexistente')));
check('descarta relacion reflexiva', r.body.descartadas.some(d=>d.includes('reflexiva')));
check('solo queda la relacion valida', r.body.relations.length===1);

console.log(`\n=== RESUMEN: ${ok} correctas, ${fail} fallas ===`);
process.exit(fail>0?1:0);
