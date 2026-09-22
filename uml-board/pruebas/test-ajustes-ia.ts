/**
 * Los ajustes de IA del navegador: que camino se toma segun lo que configuro el
 * usuario, y que la clave no se guarde cuando pidio que no se guarde.
 *
 * Se prueba sin navegador: se le pone un localStorage de mentira a globalThis,
 * que es todo lo que el modulo necesita.
 */
class AlmacenFalso {
  private datos = new Map<string, string>();
  /** Si es true, falla como en modo privado: el modulo tiene que aguantarlo. */
  roto = false;

  getItem(k: string): string | null {
    if (this.roto) throw new Error('almacenamiento bloqueado');
    return this.datos.get(k) ?? null;
  }

  setItem(k: string, v: string): void {
    if (this.roto) throw new Error('almacenamiento bloqueado');
    this.datos.set(k, v);
  }

  removeItem(k: string): void {
    this.datos.delete(k);
  }

  get contenido(): string {
    return JSON.stringify([...this.datos.entries()]);
  }
}

const almacen = new AlmacenFalso();
(globalThis as unknown as { localStorage: AlmacenFalso }).localStorage = almacen;

const {
  AJUSTES_POR_DEFECTO,
  cabecerasDeIa,
  caminoPedido,
  guardarAjustesIa,
  leerAjustesIa,
  olvidarClaveIa,
} = await import('../src/lib/ajustesIa');

let ok = 0;
let fail = 0;
const check = (n: string, cond: boolean, d: unknown = '') => {
  if (cond) {
    ok++;
    console.log(`  OK   ${n}`);
  } else {
    fail++;
    console.log(`  FALLA ${n} ${d === '' ? '' : JSON.stringify(d)}`);
  }
};

console.log('=== 1) Por defecto no se cambia nada del comportamiento anterior ===');
check('el modo por defecto es automatico', leerAjustesIa().modo === 'auto');
check('sin nada configurado, decide el servidor', caminoPedido() === 'auto');
check('y no se mandan cabeceras de clave', Object.keys(cabecerasDeIa()).length === 0);

console.log('\n=== 2) Modo local: el navegador habla con su Ollama ===');
guardarAjustesIa({ ...AJUSTES_POR_DEFECTO, modo: 'local' });
check('el camino es local', caminoPedido() === 'local');
check(
  'y no se manda ninguna clave, aunque hubiera una guardada',
  Object.keys(cabecerasDeIa({ ...leerAjustesIa(), claveNube: 'sk-secreta' })).length === 0
);

console.log('\n=== 3) Modo nube: la clave viaja en cabeceras ===');
guardarAjustesIa({
  ...AJUSTES_POR_DEFECTO,
  modo: 'nube',
  claveNube: 'sk-de-prueba',
  modeloNube: 'gpt-4o-mini',
});
check('el camino es nube', caminoPedido() === 'nube');
const cab = cabecerasDeIa();
check('manda la clave', cab['x-ia-clave'] === 'sk-de-prueba', cab);
check('manda el endpoint', cab['x-ia-base-url'] === AJUSTES_POR_DEFECTO.baseUrlNube);
check('manda el modelo', cab['x-ia-modelo'] === 'gpt-4o-mini');

console.log('\n=== 4) Sin clave, el modo nube no deja al usuario a pie ===');
guardarAjustesIa({ ...AJUSTES_POR_DEFECTO, modo: 'nube', claveNube: '' });
check('cae al servidor en vez de fallar', caminoPedido() === 'servidor');

console.log('\n=== 5) "No recordar la clave" tiene que cumplirse de verdad ===');
guardarAjustesIa({
  ...AJUSTES_POR_DEFECTO,
  modo: 'nube',
  claveNube: 'sk-no-guardar',
  recordarClave: false,
});
check('la clave no queda escrita en el almacenamiento', !almacen.contenido.includes('sk-no-guardar'), almacen.contenido.slice(0, 120));
check('pero sigue sirviendo en esta pestana', leerAjustesIa().claveNube === 'sk-no-guardar');
check('y se manda igual', cabecerasDeIa()['x-ia-clave'] === 'sk-no-guardar');

console.log('\n=== 6) Olvidar la clave ===');
olvidarClaveIa();
check('deja de estar disponible', leerAjustesIa().claveNube === '');
check('y no queda rastro en el almacenamiento', !almacen.contenido.includes('sk-no-guardar'));

console.log('\n=== 7) Sin IA ===');
guardarAjustesIa({ ...AJUSTES_POR_DEFECTO, modo: 'sin-ia' });
check('el camino es sin-ia', caminoPedido() === 'sin-ia');

console.log('\n=== 8) Si el almacenamiento falla, la aplicacion no se cae ===');
almacen.roto = true;
let tiro = false;
try {
  const a = leerAjustesIa();
  check('devuelve los valores por defecto', a.modo === 'auto');
  guardarAjustesIa({ ...a, modo: 'local' });
} catch {
  tiro = true;
}
check('ni al leer ni al guardar tira una excepcion', !tiro);
almacen.roto = false;

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
