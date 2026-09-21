// Verificacion del interprete que corre en el celular sin internet.
import { interpretarLocal } from '../src/lib/iaLocal';
import type { EdgeType, NodeType } from '../src/utils/umlConstants';

let ok = 0, fail = 0;
const check = (n: string, cond: boolean, d = '') => {
  if (cond) { ok += 1; console.log(`  OK   ${n}`); }
  else { fail += 1; console.log(`  FALLA ${n} ${d}`); }
};

const nodo = (label: string): NodeType => ({ id: label.toLowerCase(), label, x: 0, y: 0, attributes: [] });
const diagrama: NodeType[] = [nodo('Mascota'), nodo('Dueno'), nodo('Medico'), nodo('Paciente'), nodo('Producto')];
const sinNada: NodeType[] = [];
const edges: EdgeType[] = [];

const i = (texto: string, nodes = diagrama) => interpretarLocal(texto, nodes, edges);

console.log('=== 1) Crear una clase ===');
let r = i('crea una clase Cliente', sinNada);
check('reconoce la orden', r.reconocido);
check('crea una sola clase', r.actions.length === 1 && r.actions[0].target === 'class');
check('el nombre queda en PascalCase', r.actions[0].data.label === 'Cliente', `=> ${r.actions[0]?.data?.label}`);

r = i('creame la clase orden de compra', sinNada);
check('junta las palabras del nombre', r.actions[0]?.data?.label === 'OrdenDeCompra', `=> ${r.actions[0]?.data?.label}`);

// El dictado se come los articulos pegados al nombre.
for (const frase of ['crea una clase Factura', 'crear la clase Factura', 'nueva clase Factura', 'agrega una tabla Factura', 'dame la entidad Factura']) {
  r = i(frase, sinNada);
  check(`"${frase}" -> Factura`, r.actions[0]?.data?.label === 'Factura', `=> ${r.actions[0]?.data?.label}`);
}

console.log('\n=== 2) Crear con atributos y tipos dictados ===');
r = i('crea una clase Mascota con nombre texto y edad entero', sinNada);
check('crea la clase y sus dos atributos', r.actions.length === 3, `=> ${r.actions.length}`);
const attrs = r.actions.filter(a => a.target === 'attribute');
check('los nombres van en camelCase', attrs.every(a => /^[a-z]/.test(a.data.name)));
check('"texto" es String', attrs.find(a => a.data.name === 'nombre')?.data.datatype === 'String');
check('"entero" es Integer', attrs.find(a => a.data.name === 'edad')?.data.datatype === 'Integer');

r = i('crea una clase Venta con total decimal, fecha fecha y pagada booleano', sinNada);
const av = r.actions.filter(a => a.target === 'attribute');
check('"decimal" es Float', av.find(a => a.data.name === 'total')?.data.datatype === 'Float');
check('"fecha" es Date', av.find(a => a.data.name === 'fecha')?.data.datatype === 'Date');
check('"booleano" es Boolean', av.find(a => a.data.name === 'pagada')?.data.datatype === 'Boolean');
check('separa por comas y por "y"', av.length === 3, `=> ${av.length}`);

r = i('crea una clase Nota con observacion', sinNada);
check('un atributo sin tipo queda String',
  r.actions.find(a => a.target === 'attribute')?.data.datatype === 'String');

r = i('crea una clase Cosa con id entero y nombre texto', sinNada);
check('descarta el atributo id, que es implicito',
  !r.actions.some(a => a.target === 'attribute' && a.data.name === 'id'));

console.log('\n=== 3) Agregar atributos a una clase que existe ===');
r = i('agrega el atributo raza texto a Mascota');
check('reconoce la orden', r.reconocido);
check('es un atributo, no una clase nueva',
  r.actions.length === 1 && r.actions[0].target === 'attribute', `=> ${JSON.stringify(r.actions)}`);
check('lo cuelga de la clase correcta', r.actions[0].data.classId === 'Mascota');
check('con el tipo dictado', r.actions[0].data.datatype === 'String');

r = i('agregale peso decimal a Mascota');
check('"agregale" tambien funciona', r.actions[0]?.data?.name === 'peso' && r.actions[0]?.data?.datatype === 'Float',
  `=> ${JSON.stringify(r.actions[0]?.data)}`);

console.log('\n=== 4) Relaciones ===');
r = i('Mascota se relaciona con Dueno, uno a muchos');
check('crea la relacion', r.actions.length === 1 && r.actions[0].target === 'edge');
check('con las multiplicidades dictadas',
  r.actions[0].data.multiplicidadOrigen === '1' && r.actions[0].data.multiplicidadDestino === '*',
  `=> ${r.actions[0].data.multiplicidadOrigen}:${r.actions[0].data.multiplicidadDestino}`);

r = i('relaciona Producto con Mascota uno a uno');
check('uno a uno', r.actions[0]?.data?.multiplicidadDestino === '1');

console.log('\n=== 5) Muchos a muchos con clase asociativa ===');
r = i('relacion muchos a muchos entre Medico y Paciente');
check('reconoce la orden', r.reconocido);
check('crea la clase asociativa y sus dos aristas', r.actions.length === 3, `=> ${r.actions.length}`);
const asoc = r.actions.find(a => a.target === 'class');
check('la marca como asociativa', asoc?.data.asociativa === true);
check('con sus dos extremos', Array.isArray(asoc?.data.relaciona) && asoc?.data.relaciona.length === 2);
check('ninguna arista queda muchos a muchos',
  !r.actions.some(a => a.target === 'edge' && a.data.multiplicidadOrigen === '*' && a.data.multiplicidadDestino === '*'));

console.log('\n=== 6) Herencia, composicion, borrado y renombrado ===');
r = i('Mascota hereda de Producto');
check('herencia reconocida', r.actions[0]?.data?.tipo === 'herencia');
check('la hija va en source', r.actions[0]?.data?.sourceLabel === 'Mascota');

r = i('Producto se compone de Mascota');
check('composicion reconocida', r.actions[0]?.data?.tipo === 'composicion');
check('el todo va en source', r.actions[0]?.data?.sourceLabel === 'Producto');

r = i('Producto agrupa a Mascota');
check('agregacion reconocida', r.actions[0]?.data?.tipo === 'agregacion');

r = i('borra la clase Mascota');
check('borrado reconocido', r.actions[0]?.type === 'delete' && r.actions[0]?.target === 'class');
check('con el id real de la clase', r.actions[0]?.data?.id === 'mascota');

r = i('renombra Mascota a Paciente Animal');
check('renombrado reconocido', r.actions[0]?.type === 'update');
check('con el nombre nuevo en PascalCase', r.actions[0]?.data?.label === 'PacienteAnimal',
  `=> ${r.actions[0]?.data?.label}`);

console.log('\n=== 7) Cuando no puede, lo dice (no inventa) ===');
r = i('relacion muchos a muchos entre Zeta y Omega');
check('no inventa clases que no existen', r.actions.length === 0);
check('avisa que faltan', !r.reconocido && /no encontre|necesito/i.test(r.entendido), r.entendido);

r = i('borra la clase Inexistente');
check('borrar algo que no esta no hace nada', r.actions.length === 0 && !r.reconocido);

r = i('contame un chiste');
check('una orden fuera de dominio no produce acciones', r.actions.length === 0 && !r.reconocido);
check('y sugiere como pedirlo', /crea una clase/i.test(r.entendido), r.entendido);

r = i('');
check('silencio no rompe nada', r.actions.length === 0 && !r.reconocido);

r = i('crea una clase Mascota');
check('no duplica una clase que ya existe', r.actions.length === 0 && /ya existe/i.test(r.entendido), r.entendido);

console.log('\n=== 8) Tolerancia al dictado real ===');
// El reconocimiento de voz no pone acentos ni mayusculas de forma confiable.
r = i('CREA UNA CLASE Categoria CON NOMBRE TEXTO', sinNada);
check('ignora las mayusculas', r.actions[0]?.data?.label === 'Categoria', `=> ${r.actions[0]?.data?.label}`);
r = i('agrega el atributo telefono texto a dueno');
check('encuentra la clase sin acentos ni mayusculas', r.actions[0]?.data?.classId === 'Dueno',
  `=> ${r.actions[0]?.data?.classId}`);
r = i('crea una clase Pedido con nombre texto.', sinNada);
check('un punto final no se pega al nombre',
  r.actions.find(a => a.target === 'attribute')?.data.name === 'nombre');

console.log('\n=== 9) No repite una relacion que ya existe ===');
const conRelacion: EdgeType[] = [
  { id: 'e1', source: 'mascota', target: 'dueno', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
];
r = interpretarLocal('relaciona Mascota con Dueno', diagrama, conRelacion);
check('avisa que ya estan relacionadas', r.actions.length === 0 && /ya estan relacionadas/i.test(r.entendido), r.entendido);
r = interpretarLocal('relaciona Dueno con Mascota', diagrama, conRelacion);
check('tambien en el sentido inverso', r.actions.length === 0);
r = interpretarLocal('relaciona Medico con Producto', diagrama, conRelacion);
check('una relacion nueva si se crea', r.actions.length === 1);

console.log('\n=== 10) La forma de salida es la del servidor ===');
r = i('crea una clase Envio con codigo texto', sinNada);
check('cada accion tiene type, target y data',
  r.actions.every(a => typeof a.type === 'string' && typeof a.target === 'string' && a.data != null));
check('los targets son los del contrato',
  r.actions.every(a => ['class', 'attribute', 'edge'].includes(a.target)));
check('los datatypes son los cinco permitidos',
  r.actions.filter(a => a.target === 'attribute')
    .every(a => ['String', 'Integer', 'Float', 'Boolean', 'Date'].includes(a.data.datatype)));
check('los scopes son los permitidos',
  r.actions.filter(a => a.target === 'attribute')
    .every(a => ['public', 'private', 'protected'].includes(a.data.scope)));

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
