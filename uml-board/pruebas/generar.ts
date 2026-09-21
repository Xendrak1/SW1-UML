// Genera los scripts concretos para el documento de Eduardo, con el modelo de
// datos REAL de la herramienta (server/sql/schema.sql) y los casos de uso que
// pide el enunciado del parcial.
import { writeFileSync } from 'node:fs';
import { generarScriptDocumentacionEa, generarScriptEa } from '../src/utils/enterpriseArchitect';
import type { EdgeType, NodeType } from '../src/utils/umlConstants';

const nodes: NodeType[] = [
  {
    id: 'diagrama', label: 'Diagrama', x: 380, y: 40,
    attributes: [
      { name: 'nombre', datatype: 'String', scope: 'private' },
      { name: 'documento', datatype: 'String', scope: 'private' },
      { name: 'secuencia', datatype: 'Integer', scope: 'private' },
      { name: 'creadoEn', datatype: 'Date', scope: 'private' },
      { name: 'actualizadoEn', datatype: 'Date', scope: 'private' },
    ],
  },
  {
    id: 'pizarra', label: 'Pizarra', x: 40, y: 40,
    attributes: [
      { name: 'nombre', datatype: 'String', scope: 'private' },
      { name: 'creadoEn', datatype: 'Date', scope: 'private' },
    ],
  },
  {
    id: 'operacion', label: 'Operacion', x: 380, y: 340,
    attributes: [
      { name: 'identificador', datatype: 'String', scope: 'private' },
      { name: 'secuencia', datatype: 'Integer', scope: 'private' },
      { name: 'tipo', datatype: 'String', scope: 'private' },
      { name: 'contenido', datatype: 'String', scope: 'private' },
      { name: 'creadoEn', datatype: 'Date', scope: 'private' },
    ],
  },
  {
    id: 'participante', label: 'Participante', x: 40, y: 340,
    attributes: [
      { name: 'clienteId', datatype: 'String', scope: 'private' },
      { name: 'nombre', datatype: 'String', scope: 'private' },
      { name: 'color', datatype: 'String', scope: 'private' },
      { name: 'conectado', datatype: 'Boolean', scope: 'private' },
    ],
  },
  {
    id: 'clase', label: 'ClaseUml', x: 720, y: 40,
    attributes: [
      { name: 'nombre', datatype: 'String', scope: 'private' },
      { name: 'posicionX', datatype: 'Float', scope: 'private' },
      { name: 'posicionY', datatype: 'Float', scope: 'private' },
      { name: 'asociativa', datatype: 'Boolean', scope: 'private' },
    ],
  },
  {
    id: 'atributo', label: 'AtributoUml', x: 1060, y: 40,
    attributes: [
      { name: 'nombre', datatype: 'String', scope: 'private' },
      { name: 'tipoDato', datatype: 'String', scope: 'private' },
      { name: 'visibilidad', datatype: 'String', scope: 'private' },
    ],
  },
  {
    id: 'relacion', label: 'RelacionUml', x: 720, y: 340,
    attributes: [
      { name: 'tipo', datatype: 'String', scope: 'private' },
      { name: 'multiplicidadOrigen', datatype: 'String', scope: 'private' },
      { name: 'multiplicidadDestino', datatype: 'String', scope: 'private' },
    ],
  },
  {
    id: 'imagen', label: 'ImagenSubida', x: 1060, y: 340,
    attributes: [
      { name: 'archivo', datatype: 'String', scope: 'private' },
      { name: 'tipoMime', datatype: 'String', scope: 'private' },
      { name: 'tamanoBytes', datatype: 'Integer', scope: 'private' },
      { name: 'creadoEn', datatype: 'Date', scope: 'private' },
    ],
  },
];

const edges: EdgeType[] = [
  { id: 'r1', source: 'diagrama', target: 'pizarra', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  // El log de operaciones no existe sin su diagrama: composicion (borra en cascada).
  { id: 'r2', source: 'diagrama', target: 'operacion', tipo: 'composicion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'r3', source: 'participante', target: 'operacion', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'r4', source: 'diagrama', target: 'clase', tipo: 'composicion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'r5', source: 'clase', target: 'atributo', tipo: 'composicion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'r6', source: 'diagrama', target: 'relacion', tipo: 'composicion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'r7', source: 'clase', target: 'relacion', tipo: 'asociacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
  { id: 'r8', source: 'diagrama', target: 'imagen', tipo: 'agregacion', multiplicidadOrigen: '1', multiplicidadDestino: '*' },
];

const modelo = { nodes, edges };

/**
 * Los 25 casos de uso del documento, con su actor y los diagramas que el
 * documento promete para cada uno.
 *
 * La lista sale del documento, no al reves: si el modelo de EA tuviera otros
 * casos de uso o mas diagramas de los que el texto detalla, el modelo estaria
 * diciendo algo distinto del documento, y esa diferencia es justo lo que se
 * nota en la defensa de autoria.
 *
 * DOS actores, no cinco. El anfitrion ESPECIALIZA al participante: hereda sus
 * veinte casos de uso y agrega los cinco que solo tienen sentido para quien
 * abre la sesion. Antes eran actores paralelos y trece casos de uso figuraban
 * con los dos a la vez, que es la senal de que en realidad eran uno.
 */
const casosDeUso = [
  { codigo: 'CU01', nombre: 'Crear pizarra colaborativa', entidad: 'Pizarra', actor: 'Modelador anfitrion', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU02', nombre: 'Compartir enlace de invitacion', entidad: 'Pizarra', actor: 'Modelador anfitrion', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU03', nombre: 'Unirse a una pizarra existente', entidad: 'Participante', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU04', nombre: 'Administrar pizarras', entidad: 'Pizarra', actor: 'Modelador anfitrion', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU05', nombre: 'Crear y editar clases con sus atributos', entidad: 'ClaseUml', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU06', nombre: 'Crear relaciones entre clases', entidad: 'RelacionUml', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU07', nombre: 'Crear relacion muchos a muchos con clase asociativa', entidad: 'RelacionUml', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU08', nombre: 'Editar el diagrama mediante instruccion escrita', entidad: 'ClaseUml', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: true },
  { codigo: 'CU09', nombre: 'Editar el diagrama mediante instruccion por voz', entidad: 'ClaseUml', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU10', nombre: 'Operar el sistema por voz desde el telefono', entidad: 'ClaseUml', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU11', nombre: 'Importar un diagrama desde una fotografia o boceto', entidad: 'ImagenSubida', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU12', nombre: 'Importar un diagrama desde archivo', entidad: 'Diagrama', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU13', nombre: 'Exportar el diagrama a otra herramienta CASE', entidad: 'Diagrama', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU14', nombre: 'Visualizar los participantes conectados y su actividad', entidad: 'Participante', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU15', nombre: 'Trabajar sin conexion y sincronizar al reconectar', entidad: 'Operacion', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: true },
  { codigo: 'CU16', nombre: 'Consultar la bitacora de operaciones del diagrama', entidad: 'Operacion', actor: 'Modelador anfitrion', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU17', nombre: 'Generar el modelo conceptual de datos', entidad: 'ClaseUml', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU18', nombre: 'Generar el mapeo objeto-relacional y el esquema logico', entidad: 'RelacionUml', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU19', nombre: 'Analizar la normalizacion del esquema', entidad: 'RelacionUml', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU20', nombre: 'Generar el DDL de la base de datos', entidad: 'Diagrama', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU21', nombre: 'Generar el backend en Spring Boot', entidad: 'Diagrama', actor: 'Modelador participante', conSecuencia: true, conClasesDinamicas: false },
  { codigo: 'CU22', nombre: 'Generar la coleccion de pruebas para Postman', entidad: 'Diagrama', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU23', nombre: 'Generar el frontend de prueba', entidad: 'Diagrama', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU24', nombre: 'Consultar la guia de usuario', entidad: 'Diagrama', actor: 'Modelador participante', conSecuencia: false, conClasesDinamicas: false },
  { codigo: 'CU25', nombre: 'Consultar el diagnostico del sistema y el estado de la IA', entidad: 'Diagrama', actor: 'Modelador anfitrion', conSecuencia: false, conClasesDinamicas: false },
];

/** Las tres iteraciones, tal como las agrupa el documento. */
const ciclos = [
  { nombre: 'Ciclo 1 - Elaboracion: arquitectura colaborativa',
    casos: ['CU01', 'CU02', 'CU03', 'CU04', 'CU05', 'CU06', 'CU07', 'CU14', 'CU15', 'CU16'] },
  { nombre: 'Ciclo 2 - Construccion: interfaz asistida por IA',
    casos: ['CU08', 'CU09', 'CU10', 'CU11', 'CU24', 'CU25'] },
  { nombre: 'Ciclo 3 - Construccion: diseno de datos y generacion',
    casos: ['CU12', 'CU13', 'CU17', 'CU18', 'CU19', 'CU20', 'CU21', 'CU22', 'CU23'] },
];

const modulos = [
  { nombre: 'Colaboracion', clases: ['Pizarra', 'Diagrama', 'Operacion', 'Participante'] },
  { nombre: 'Modelado UML', clases: ['ClaseUml', 'AtributoUml', 'RelacionUml'] },
  { nombre: 'Inteligencia Artificial', clases: ['ImagenSubida'] },
];

writeFileSync('salida/EA-ModeloDeDatos.js', generarScriptEa(modelo, {
  paquete: '3.2 Modelo de Datos',
  diagrama: 'Diseno Conceptual',
  autor: 'Eduardo Rodriguez',
}));

writeFileSync('salida/EA-CrearDocumentacion.js', generarScriptDocumentacionEa(modelo, {
  sistema: 'Herramienta CASE Colaborativa',
  autor: 'Eduardo Rodriguez',
  // El actor por defecto; cada caso de uso trae el suyo.
  actor: 'Modelador participante',
  casosDeUso,
  modulos,
  ciclos,
  // El anfitrion es un modelador participante con cinco casos de uso mas.
  herenciaActores: [['Modelador anfitrion', 'Modelador participante']],
}));

console.log('Clases:', nodes.length, '| Relaciones:', edges.length, '| Casos de uso:', casosDeUso.length);
const conSeq = casosDeUso.filter(c => c.conSecuencia).length;
const conDin = casosDeUso.filter(c => c.conClasesDinamicas).length;
console.log(
  `Diagramas: ${casosDeUso.length} de casos de uso + ${conSeq} de secuencia + ${conDin} de clases ` +
    `dinamicas + ${ciclos.length} por iteracion + ${modulos.length * 3} de modulos + 5 de arquitectura ` +
    `= ${casosDeUso.length + conSeq + conDin + ciclos.length + modulos.length * 3 + 5}`
);
