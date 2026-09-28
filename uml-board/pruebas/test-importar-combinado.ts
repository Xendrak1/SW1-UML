/**
 * Importar una segunda foto del mismo pizarron.
 *
 * El caso real que motiva esto: en clase se dibuja Venta-Cliente-Producto y
 * despues se lo extiende con un Vendedor y con la intermedia Detalle. Antes cada
 * foto se transcribia entera y se agregaba, asi que Venta, Cliente y Producto
 * quedaban duplicadas y las relaciones nuevas apuntaban a las copias.
 *
 * Aca se comprueba lo contrario: lo que ya esta no se toca, lo nuevo se engancha
 * a los nodos que ya existen, y la intermedia queda bien armada.
 */
import { convertAccionesToUml } from '../src/services/importarCombinado';
import type { NodeType } from '../src/utils/umlConstants';

let ok = 0;
let fail = 0;
const check = (n: string, cond: boolean, d: unknown = '') => {
  if (cond) {
    ok++;
    console.log(`  OK   ${n}`);
  } else {
    fail++;
    console.log(`  FALLA ${n}`, d);
  }
};

// El diagrama de la primera foto, ya en el lienzo.
const actuales: NodeType[] = [
  {
    id: 'n-venta',
    label: 'Venta',
    x: 0,
    y: 0,
    attributes: [{ name: 'fecha', datatype: 'Date', scope: 'private' }],
  },
  {
    id: 'n-cliente',
    label: 'Cliente',
    x: 0,
    y: 0,
    attributes: [
      { name: 'nombre', datatype: 'String', scope: 'private' },
      { name: 'email', datatype: 'String', scope: 'private' },
    ],
  },
  {
    id: 'n-producto',
    label: 'Producto',
    x: 0,
    y: 0,
    attributes: [
      { name: 'nombre', datatype: 'String', scope: 'private' },
      { name: 'precio', datatype: 'Float', scope: 'private' },
      { name: 'stock', datatype: 'Integer', scope: 'private' },
    ],
  },
] as NodeType[];

// Lo que el modelo devuelve mirando la segunda foto.
const acciones = [
  // Ya existe: no se debe duplicar aunque el modelo la repita.
  { type: 'create', target: 'class', data: { label: 'Venta', attributes: [] } },
  // Con acento y en minuscula: igual tiene que reconocerla como la misma.
  { type: 'create', target: 'class', data: { label: 'prodúcto', attributes: [] } },
  {
    type: 'create',
    target: 'class',
    data: { label: 'Vendedor', attributes: [{ name: 'nombre', datatype: 'String' }] },
  },
  {
    type: 'create',
    target: 'edge',
    data: {
      sourceLabel: 'Vendedor',
      targetLabel: 'Venta',
      tipo: 'asociacion',
      multiplicidadOrigen: '1',
      multiplicidadDestino: '*',
    },
  },
  {
    type: 'create',
    target: 'class',
    data: {
      label: 'Detalle',
      attributes: [
        { name: 'cantidad', datatype: 'Integer' },
        { name: 'precioUnit', datatype: 'Float' },
      ],
      asociativa: true,
      relaciona: ['Venta', 'Producto'],
    },
  },
  // Atributo nuevo sobre una clase que ya estaba.
  { type: 'create', target: 'attribute', data: { classId: 'Venta', name: 'total', datatype: 'Float' } },
  // Atributo que ya tiene: no debe repetirse.
  { type: 'create', target: 'attribute', data: { classId: 'Cliente', name: 'email', datatype: 'String' } },
  // El id es implicito.
  { type: 'create', target: 'attribute', data: { classId: 'Venta', name: 'id', datatype: 'Integer' } },
];

const { nodes, edges, atributosNuevos } = convertAccionesToUml(acciones, actuales);

console.log('=== 1) No duplica lo que ya estaba ===');
check('solo crea Vendedor y Detalle', nodes.length === 2, nodes.map(n => n.label));
check('no vuelve a crear Venta', !nodes.some(n => n.label === 'Venta'));
check(
  'ni Producto escrito distinto (acentos y mayusculas)',
  !nodes.some(n => n.label.toLowerCase().includes('produ')),
  nodes.map(n => n.label)
);

console.log('\n=== 2) Lo nuevo se engancha a lo viejo ===');
const eVendedor = edges.find(e => e.source === nodes.find(n => n.label === 'Vendedor')?.id);
check('la relacion de Vendedor apunta a la Venta que ya existia', eVendedor?.target === 'n-venta', eVendedor);

console.log('\n=== 3) La clase intermedia ===');
const detalle = nodes.find(n => n.label === 'Detalle');
check('queda marcada como asociativa', detalle?.asociativa === true);
check(
  'y relaciona los nodos existentes, no copias',
  detalle?.relaciona?.[0] === 'n-venta' && detalle?.relaciona?.[1] === 'n-producto',
  detalle?.relaciona
);
check(
  'con sus dos aristas generadas',
  edges.filter(e => e.source === detalle?.id || e.target === detalle?.id).length === 2,
  edges
);
check('y conserva sus atributos propios', detalle?.attributes?.length === 2);

console.log('\n=== 4) Atributos sobre clases existentes ===');
check('agrega total a Venta', atributosNuevos.some(a => a.nodeId === 'n-venta' && a.attribute.name === 'total'));
check('con el tipo correcto', atributosNuevos.find(a => a.attribute.name === 'total')?.attribute.datatype === 'Float');
check('no repite el email que Cliente ya tenia', !atributosNuevos.some(a => a.nodeId === 'n-cliente'));
check('ni agrega un atributo id', !atributosNuevos.some(a => a.attribute.name.toLowerCase() === 'id'));

console.log('\n=== 5) Una foto que no aporta nada ===');
const vacio = convertAccionesToUml([], actuales);
check('no inventa nodos', vacio.nodes.length === 0);
check('ni relaciones', vacio.edges.length === 0);

console.log('\n=== 6) Diagrama vacio: la foto entra completa ===');
const desdeCero = convertAccionesToUml(
  [{ type: 'create', target: 'class', data: { label: 'Venta', attributes: [] } }],
  []
);
check('crea la clase', desdeCero.nodes.length === 1 && desdeCero.nodes[0].label === 'Venta');

console.log('\n=== 7) No dibuja lineas repetidas entre las mismas dos clases ===');
// Lo que hacia el modelo mirando la foto de la pizarra: repetir la relacion
// Venta-Producto (la ve desde los dos lados y ademas al describir la intermedia).
const repetidas = convertAccionesToUml(
  [
    { type: 'create', target: 'edge', data: { sourceLabel: 'Venta', targetLabel: 'Producto', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' } },
    { type: 'create', target: 'edge', data: { sourceLabel: 'Producto', targetLabel: 'Venta', tipo: 'asociacion', multiplicidadOrigen: '*', multiplicidadDestino: '1' } },
    { type: 'create', target: 'edge', data: { sourceLabel: 'Venta', targetLabel: 'Producto', tipo: 'agregacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' } },
  ],
  actuales
);
check('de tres relaciones iguales queda una', repetidas.edges.length === 1, repetidas.edges.length);

console.log('\n=== 8) Ni encima de una que ya estaba dibujada ===');
const yaDibujada = convertAccionesToUml(
  [
    { type: 'create', target: 'edge', data: { sourceLabel: 'Venta', targetLabel: 'Cliente', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' } },
  ],
  actuales,
  [
    {
      id: 'e-vieja',
      source: 'n-cliente',
      target: 'n-venta',
      tipo: 'asociacion',
      multiplicidadOrigen: '1',
      multiplicidadDestino: '*',
    },
  ] as never
);
check('no la vuelve a trazar, ni al reves', yaDibujada.edges.length === 0, yaDibujada.edges);

console.log('\n=== 9) La intermedia no duplica lo que ya se trazo ===');
const conIntermedia = convertAccionesToUml(
  [
    { type: 'create', target: 'class', data: { label: 'Detalle', attributes: [], asociativa: true, relaciona: ['Venta', 'Producto'] } },
    { type: 'create', target: 'edge', data: { sourceLabel: 'Detalle', targetLabel: 'Venta', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' } },
  ],
  actuales
);
check('quedan sus dos aristas, no tres', conIntermedia.edges.length === 2, conIntermedia.edges.length);

console.log(`\n=== RESULTADO: ${ok} OK, ${fail} fallas de ${ok + fail} ===`);
process.exit(fail === 0 ? 0 : 1);
