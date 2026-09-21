import { chromium } from 'playwright';
const APP='http://localhost:5180', API='http://localhost:4000', MOCK='http://127.0.0.1:11434';
const wait = ms => new Promise(r=>setTimeout(r,ms));
const set = e => fetch(`${MOCK}/_set/${e}`).then(r=>r.text());
let ok=0, fail=0;
const check=(n,c,d='')=>{ if(c){ok++;console.log(`  OK   ${n}`);} else {fail++;console.log(`  FALLA ${n} ${d}`);} };

const nuevaPizarra = async nombre =>
  (await (await fetch(`${API}/api/boards`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:nombre})})).json());
const snap = id => fetch(`${API}/api/diagrams/${id}`).then(r=>r.json());

const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

async function sesion(boardId, nombre, extra={}) {
  const ctx = await browser.newContext({ viewport:{width:1400,height:880}, ...extra });
  const page = await ctx.newPage();
  const errores=[];
  page.on('console', m=>{ if(m.type()==='error') errores.push(m.text()); });
  page.on('dialog', d=>d.accept());
  await page.addInitScript(([n,b])=>{
    localStorage.setItem('case.identity', JSON.stringify({clientId:crypto.randomUUID(),name:n,color:'#e74c3c'}));
    localStorage.setItem('case.boardId', b);
  },[nombre,boardId]);
  await page.goto(APP,{waitUntil:'networkidle'});
  // El armazon debe quedar guardado antes de poder probar el modo sin conexion.
  await page.evaluate(() => navigator.serviceWorker?.ready.then(() => undefined)).catch(()=>undefined);
  await wait(1600);
  return {ctx,page,nombre,errores};
}
const etiquetas = s => s.page.evaluate(()=>[...document.querySelectorAll('input')].map(i=>i.value).filter(v=>/^[A-Z]/.test(v)).sort());
const barra = s => s.page.locator('.toolbar').innerText();
const clickMenu = async (s, menu, textoItem) => {
  const btns = s.page.locator('.toolbar button');
  const t = await btns.allInnerTexts();
  await btns.nth(t.findIndex(x=>new RegExp(menu).test(x))).click();
  await wait(350);
  const items = s.page.locator('.menu .menu__item');
  const ti = await items.allInnerTexts();
  const i = ti.findIndex(x=>new RegExp(textoItem,'i').test(x));
  if (i<0) throw new Error(`no encontre "${textoItem}" en ${menu}: ${JSON.stringify(ti)}`);
  await items.nth(i).click();
};

// ============================================================ 1) IMPORTAR POR FOTO
console.log('=== 1) Importar un diagrama desde una foto, en el navegador ===');
const b1 = await nuevaPizarra('Foto');
const a = await sesion(b1.id, 'Eduardo');
const espectador = await sesion(b1.id, 'Ana');
await wait(1000);
await set('imagen');

// El input de archivo esta oculto: se le asigna el archivo directamente, como hace el usuario al elegirlo
const inputFoto = a.page.locator('input[type="file"][accept="image/*"]');
check('existe el selector de imagen', await inputFoto.count() === 1);
await inputFoto.setInputFiles('/tmp/diagrama-foto.png');
await wait(4000);

const tras = await etiquetas(a);
check('reconocio las clases de la imagen', tras.includes('Mascota') && tras.includes('Dueno'), JSON.stringify(tras));
check('descarto la duplicada (solo una Mascota)', tras.filter(x=>x==='Mascota').length===1, JSON.stringify(tras));
const vistoPorAna = await etiquetas(espectador);
check('Ana las recibio por WebSocket', vistoPorAna.includes('Mascota') && vistoPorAna.includes('Dueno'), JSON.stringify(vistoPorAna));

const s1 = await snap(b1.diagram_id);
check('persistidas en Postgres', s1.doc.nodes.length===2, `nodos=${s1.doc.nodes.length}`);
check('la relacion tambien', s1.doc.edges.length===1, `aristas=${s1.doc.edges.length}`);
const rel = s1.doc.edges[0];
check('el "rombo lleno" quedo como composicion', rel?.data?.edgeType==='composicion', JSON.stringify(rel?.data));
check('la multiplicidad "n" quedo como *', rel?.data?.targetMultiplicity==='*', JSON.stringify(rel?.data));
const tipos = s1.doc.nodes.flatMap(n=>n.data.attributes.map(at=>at.type));
check('normalizo el tipo "texto" a String', tipos.every(t=>['String','Integer','Float','Boolean','Date'].includes(t)), JSON.stringify(tipos));
check('la imagen quedo archivada en el servidor',
      (await (await fetch(`${API}/api/uploads`)).json()).length > 0);

// ============================================================ 2) COLA OFFLINE TRAS RECARGAR
console.log('\n=== 2) La cola offline sobrevive a recargar la pagina ===');
const b2 = await nuevaPizarra('Offline recarga');
const c = await sesion(b2.id, 'Luis');
await wait(900);
await c.ctx.setOffline(true);
await wait(700);
check('detecta que no hay conexion', /Sin conexión/.test(await barra(c)));

// Tres cambios sin red
const btns = c.page.locator('.toolbar button');
const tb = await btns.allInnerTexts();
const iClase = tb.findIndex(x=>/^\+?\s*Clase$/.test(x.trim()));
for (let i=0;i<3;i++){ await btns.nth(iClase).click(); await wait(400); }
const enCola = /(\d+) en cola/.exec(await barra(c));
check('las tres quedaron en cola', enCola && Number(enCola[1])>=3, JSON.stringify(enCola?.[0]));
const localesAntes = (await etiquetas(c)).length;

// Recargar SIN red: es el escenario que la documentacion afirma soportar
await c.page.reload({waitUntil:'domcontentloaded'});
await c.page.waitForSelector('.toolbar', { timeout: 15000 });
await wait(1500);
const colaTrasRecarga = /(\d+) en cola/.exec(await barra(c));
check('la cola sobrevivio a la recarga', colaTrasRecarga && Number(colaTrasRecarga[1])>=3, JSON.stringify(colaTrasRecarga?.[0]));
const localesDespues = (await etiquetas(c)).length;
check('el documento en cache tambien', localesDespues >= localesAntes, `antes=${localesAntes} despues=${localesDespues}`);

const s2antes = await snap(b2.diagram_id);
check('el servidor todavia no las tiene', s2antes.doc.nodes.length===0, `nodos=${s2antes.doc.nodes.length}`);

await c.ctx.setOffline(false);
await wait(5000);
check('tras volver la red queda en linea', /En línea/.test(await barra(c)), await barra(c));
const colaFinal = /(\d+) en cola/.exec(await barra(c));
check('la cola se vacio', !colaFinal, JSON.stringify(colaFinal?.[0]));
const s2 = await snap(b2.diagram_id);
check('las tres llegaron al servidor', s2.doc.nodes.length===3, `nodos=${s2.doc.nodes.length}`);
check('sin duplicados por el reenvio', s2.doc.nodes.length===3);

// ============================================================ 3) MOVIL POR VOZ
console.log('\n=== 3) El asistente de voz del movil aplica sobre la pizarra compartida ===');
const b3 = await nuevaPizarra('Voz movil');
const escritorio = await sesion(b3.id, 'Eduardo');
await wait(800);

// Reconocimiento de voz simulado: dispara un resultado final, igual que el motor del sistema
const movilCtx = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
const movil = await movilCtx.newPage();
const erroresMovil=[];
movil.on('console', m=>{ if(m.type()==='error') erroresMovil.push(m.text()); });
await movil.addInitScript(b=>{
  localStorage.setItem('case.boardId', b);
  localStorage.setItem('case.identity', JSON.stringify({clientId:crypto.randomUUID(),name:'Eduardo movil',color:'#2980b9'}));
  // Sustituto del motor de voz del dispositivo
  class FakeRecognition {
    constructor(){ this.lang=''; this.continuous=false; this.interimResults=false; }
    start(){
      setTimeout(()=>{
        const texto = window.__dictado || 'crea una clase Mascota con nombre texto y edad entero';
        this.onresult?.({ resultIndex:0, results: Object.assign([[{transcript: texto}]], { 0: Object.assign([{transcript: texto}], {isFinal:true}), length:1 }) });
        this.onend?.();
      }, 250);
    }
    stop(){ this.onend?.(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
  // La sintesis de voz no existe en el navegador de prueba
  window.speechSynthesis = { speak(){}, cancel(){} };
  window.SpeechSynthesisUtterance = function(t){ this.text=t; };
}, b3.id);
await movil.goto(`${APP}/voz`,{waitUntil:'networkidle'});
await wait(2000);

const controles = await movil.locator('button').count();
check('la pantalla movil tiene un solo control', controles===2 || controles===1, `botones=${controles} (microfono + tema)`);
check('muestra el estado de conexion', /Conectado|Sin conexión/.test(await movil.locator('body').innerText()));

await set('ok');
const micro = movil.locator('button[aria-label="Tocá para hablar"]');
check('el control de voz es identificable', await micro.count()===1, `encontrados=${await micro.count()}`);
await micro.click();
await wait(4500);
const textoMovil = await movil.locator('body').innerText();
check('transcribio la instruccion', /Mascota/.test(textoMovil), textoMovil.split('\n').slice(0,6).join(' / '));
check('respondio con el resumen de lo que hizo', /cre|Listo/i.test(textoMovil), textoMovil.split('\n').filter(Boolean).slice(-4).join(' / '));

const s3 = await snap(b3.diagram_id);
check('la clase llego al documento compartido', s3.doc.nodes.some(n=>n.data.label==='Mascota'), JSON.stringify(s3.doc.nodes.map(n=>n.data.label)));
const vistoEscritorio = await etiquetas(escritorio);
check('el escritorio la ve en tiempo real', vistoEscritorio.includes('Mascota'), JSON.stringify(vistoEscritorio));
const opsMovil = await (await fetch(`${API}/api/diagrams/${b3.diagram_id}/ops`)).json();
check('la bitacora registra al autor movil', opsMovil.some(o=>o.actorName==='Eduardo movil'), JSON.stringify(opsMovil.map(o=>o.actorName)));

console.log('\n=== 4) Consola ===');
for (const s of [a, espectador, c, escritorio]) {
  const graves = s.errores.filter(
    e => !/404|Failed to load resource|500|not found|ERR_INTERNET_DISCONNECTED|WebSocket connection/.test(e)
  );
  check(`${s.nombre}: sin errores`, graves.length===0, JSON.stringify(graves.slice(0,2)));
}
const gravesMovil = erroresMovil.filter(
  e => !/404|Failed to load resource|500|not found|ERR_INTERNET_DISCONNECTED|WebSocket connection/.test(e)
);
check('movil: sin errores', gravesMovil.length===0, JSON.stringify(gravesMovil.slice(0,2)));

console.log(`\n=== RESUMEN: ${ok} correctas, ${fail} fallas ===`);
await browser.close();
process.exit(fail>0?1:0);
