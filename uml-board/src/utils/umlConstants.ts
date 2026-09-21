export type AttributeType = {
  name: string;
  scope: 'public' | 'protected' | 'private';
  datatype: 'Integer' | 'Float' | 'Boolean' | 'Date' | 'String';
};

export type NodeType = {
  id: string;
  label: string;
  x: number;
  y: number;
  height?: number;
  attributes?: AttributeType[];
  asociativa?: boolean; // true si es tabla intermedia
  relaciona?: [string, string]; // IDs de las clases relacionadas
};

export type EdgeType = {
  id: string;
  source: string;
  target: string;
  tipo: 'asociacion' | 'agregacion' | 'composicion' | 'herencia' | 'dependencia';
  multiplicidadOrigen: '1' | '*';
  multiplicidadDestino: '1' | '*';
};

export type BoardType = {
  id: string;
  name: string;
  nodes: NodeType[];
  edges: EdgeType[];
  zoom: number;
  panOffset: { x: number; y: number };
};

export const ATTR_HEIGHT = 28;
// 240 en vez de 220: con 220 los nombres de atributo algo largos se cortaban.
export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 120;

// 🔧 Función para calcular altura dinámica de nodos según sus atributos
export const calculateNodeHeight = (node: NodeType): number => {
  const headerHeight = 40; // Altura del encabezado con el nombre de la clase
  const attributesHeight = (node.attributes?.length || 0) * ATTR_HEIGHT;
  const padding = 20; // Padding inferior
  const minHeight = NODE_HEIGHT; // Altura mínima

  const calculatedHeight = headerHeight + attributesHeight + padding;
  return Math.max(minHeight, calculatedHeight);
};

export const initialNodes: NodeType[] = [
  // Persona con dirección (asociación 1:1)
  {
    id: '1',
    label: 'Persona',
    x: 100,
    y: 100,
    attributes: [
      { name: 'nombre', scope: 'private', datatype: 'String' },
      { name: 'edad', scope: 'private', datatype: 'Integer' },
    ],
  },
  {
    id: '2',
    label: 'Direccion',
    x: 350,
    y: 100,
    attributes: [
      { name: 'calle', scope: 'private', datatype: 'String' },
      { name: 'numero', scope: 'private', datatype: 'Integer' },
    ],
  },
  // Empresa con empleados (agregación 1:N)
  {
    id: '3',
    label: 'Empresa',
    x: 100,
    y: 300,
    attributes: [{ name: 'nombreEmpresa', scope: 'private', datatype: 'String' }],
  },
  {
    id: '4',
    label: 'Empleado',
    x: 350,
    y: 300,
    attributes: [
      { name: 'nombreEmpleado', scope: 'private', datatype: 'String' },
      { name: 'salario', scope: 'private', datatype: 'Float' },
    ],
  },
  // Proyecto con tareas (composición 1:N)
  {
    id: '5',
    label: 'Proyecto',
    x: 600,
    y: 100,
    attributes: [{ name: 'titulo', scope: 'private', datatype: 'String' }],
  },
  {
    id: '6',
    label: 'Tarea',
    x: 850,
    y: 100,
    attributes: [
      { name: 'descripcion', scope: 'private', datatype: 'String' },
      { name: 'completada', scope: 'private', datatype: 'Boolean' },
    ],
  },
  // Herencia: Vehiculo -> Auto
  {
    id: '7',
    label: 'Vehiculo',
    x: 600,
    y: 300,
    attributes: [{ name: 'marca', scope: 'private', datatype: 'String' }],
  },
  {
    id: '8',
    label: 'Auto',
    x: 850,
    y: 300,
    attributes: [{ name: 'puertas', scope: 'private', datatype: 'Integer' }],
  },
  // Muchos a muchos: Estudiante <-> Curso (tabla intermedia Inscripcion)
  {
    id: '9',
    label: 'Estudiante',
    x: 100,
    y: 500,
    attributes: [{ name: 'nombreEstudiante', scope: 'private', datatype: 'String' }],
  },
  {
    id: '10',
    label: 'Curso',
    x: 350,
    y: 500,
    attributes: [{ name: 'nombreCurso', scope: 'private', datatype: 'String' }],
  },
  {
    id: '11',
    label: 'Inscripcion',
    x: 600,
    y: 500,
    attributes: [{ name: 'fecha', scope: 'private', datatype: 'Date' }],
    asociativa: true,
    relaciona: ['9', '10'], // Estudiante-Curso
  },
  // Relación 1 a muchos: Autor-Libro
  {
    id: '12',
    label: 'Autor',
    x: 100,
    y: 700,
    attributes: [{ name: 'nombreAutor', scope: 'private', datatype: 'String' }],
  },
  {
    id: '13',
    label: 'Libro',
    x: 350,
    y: 700,
    attributes: [{ name: 'tituloLibro', scope: 'private', datatype: 'String' }],
  },
  // Sistema de ventas: Venta-DetalleVenta-Producto-Categoria
  {
    id: '14',
    label: 'Venta',
    x: 1100,
    y: 100,
    attributes: [
      { name: 'clienteNombre', scope: 'private', datatype: 'String' },
      { name: 'fecha', scope: 'private', datatype: 'Date' },
      { name: 'total', scope: 'private', datatype: 'Float' },
    ],
  },
  {
    id: '15',
    label: 'DetalleVenta',
    x: 1350,
    y: 100,
    attributes: [
      { name: 'cantidad', scope: 'private', datatype: 'Integer' },
      { name: 'precioUnitario', scope: 'private', datatype: 'Float' },
    ],
    asociativa: true,
    relaciona: ['14', '16'], // Venta-Producto
  },
  {
    id: '16',
    label: 'Producto',
    x: 1100,
    y: 300,
    attributes: [
      { name: 'nombre', scope: 'private', datatype: 'String' },
      { name: 'descripcion', scope: 'private', datatype: 'String' },
      { name: 'imagenUrl', scope: 'private', datatype: 'String' },
      { name: 'precio', scope: 'private', datatype: 'Float' },
      { name: 'stock', scope: 'private', datatype: 'Integer' },
    ],
  },
  {
    id: '17',
    label: 'Categoria',
    x: 1350,
    y: 300,
    attributes: [
      { name: 'nombre', scope: 'private', datatype: 'String' },
      { name: 'descripcion', scope: 'private', datatype: 'String' },
    ],
  },
];

export const initialEdges: EdgeType[] = [
  // Asociación 1:1 Persona-Direccion
  {
    id: 'e1',
    source: '1',
    target: '2',
    tipo: 'asociacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '1',
  },
  // Agregación 1:N Empresa-Empleado
  {
    id: 'e2',
    source: '3',
    target: '4',
    tipo: 'agregacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
  // Composición 1:N Proyecto-Tarea
  {
    id: 'e3',
    source: '5',
    target: '6',
    tipo: 'composicion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
  // Herencia Auto-Vehiculo
  {
    id: 'e4',
    source: '8',
    target: '7',
    tipo: 'herencia',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '1',
  },
  // Muchos a muchos Estudiante-Curso vía Inscripcion
  {
    id: 'e5',
    source: '9',
    target: '11',
    tipo: 'asociacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
  {
    id: 'e6',
    source: '10',
    target: '11',
    tipo: 'asociacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
  // Relación 1 a muchos: Autor-Libro
  {
    id: 'e7',
    source: '12',
    target: '13',
    tipo: 'asociacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
  // Sistema de ventas: relaciones
  // Venta M:N Producto vía DetalleVenta (tabla asociativa)
  {
    id: 'e8',
    source: '14',
    target: '15',
    tipo: 'asociacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
  {
    id: 'e9',
    source: '16',
    target: '15',
    tipo: 'asociacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
  // Categoria 1:* Producto
  {
    id: 'e10',
    source: '17',
    target: '16',
    tipo: 'asociacion',
    multiplicidadOrigen: '1',
    multiplicidadDestino: '*',
  },
];

export const initialBoards: BoardType[] = [
  {
    id: '1',
    name: 'Diagrama Principal',
    nodes: initialNodes,
    edges: initialEdges,
    zoom: 1,
    panOffset: { x: 0, y: 0 },
  },
  {
    id: '2',
    name: 'Pizarra 2',
    nodes: [],
    edges: [],
    zoom: 1,
    panOffset: { x: 0, y: 0 },
  },
  {
    id: '3',
    name: 'Pizarra 3',
    nodes: [],
    edges: [],
    zoom: 1,
    panOffset: { x: 0, y: 0 },
  },
];

// Solo tipos y constantes, sin lógica de UI ni lógica de negocio
