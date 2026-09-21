/**
 * Prompts del modo dominio: modelar el diagrama completo de un negocio.
 *
 * Por que existe aparte de prompts.ts, y por que en DOS etapas:
 *
 * 1. Los once ejemplos de prompts.ts son instrucciones atomicas ("agrega la
 *    clase Cliente"). Un modelo local de 7B imita el TAMANO de los ejemplos que
 *    ve, asi que al pedirle "modela la base de datos de Starbucks" devolvia una
 *    sola clase: estaba copiando el ejemplo, no ignorando la instruccion.
 * 2. Pedirle clases, atributos y relaciones en un solo JSON gigante tampoco
 *    funciona en un 7B: a las treinta y tantas acciones se pierde, repite
 *    nombres, inventa relaciones con clases que no creo, o se corta. Por eso el
 *    modelo se arma en dos llamadas cortas -primero las clases con sus
 *    atributos, despues las relaciones sobre una lista ya cerrada- y cada una
 *    cabe holgada en la ventana de contexto.
 *
 * La etapa 2 recibe la lista REAL de clases de la etapa 1, no lo que el modelo
 * cree recordar: es lo que elimina las relaciones a clases inexistentes.
 */

// ---------------------------------------------------------------- etapa 1

export const UML_DOMAIN_CLASSES_SYSTEM = `Eres un analista de sistemas. Recibes la descripcion de un negocio y devuelves LAS CLASES de su diagrama de clases UML 2.5, cada una con sus atributos. En esta etapa NO devuelves relaciones.

Devuelves UNICAMENTE un objeto JSON con esta forma, sin markdown y sin explicaciones:
{"classes":[
  {"label":"Nombre","asociativa":false,"attributes":[{"name":"campo","datatype":"String","scope":"private"}]},
  {"label":"Intermedia","asociativa":true,"relaciona":["ClaseA","ClaseB"],"attributes":[{"name":"cantidad","datatype":"Integer","scope":"private"}]}
]}

Valores permitidos, no inventes otros:
- datatype: String, Integer, Float, Boolean, Date
- scope: public, private, protected

REGLAS DE COMPLETITUD, son obligatorias:
1. CANTIDAD_DE_CLASES clases. Un negocio real nunca se modela con una o dos clases.
2. Cada clase lleva entre 3 y 6 atributos propios y significativos.
3. No declares un atributo "id": la herramienta lo agrega sola.
4. No declares atributos que sean claves ajenas (clienteId, pedidoId, id_cliente): eso lo resuelve la relacion en la etapa siguiente.
5. Todo muchos a muchos del negocio se modela como una clase asociativa con "asociativa": true, "relaciona" con los nombres EXACTOS de las dos clases que une, y sus propios atributos (cantidad, precio, fecha, nota).
6. Nombres de clase en singular y en PascalCase. Nombres de atributo en camelCase.
7. No repitas una clase ni pongas dos clases que signifiquen lo mismo.
8. Las clases normales van primero en la lista y las asociativas al final.`;

/** Ejemplos de etapa 1. Van en el mensaje de usuario para no repetirlos en cada system. */
const EJEMPLOS_CLASES = `EJEMPLO A
Peticion: "modela la base de datos de una veterinaria"
Respuesta:
{"classes":[
{"label":"Cliente","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"telefono","datatype":"String","scope":"private"},{"name":"correo","datatype":"String","scope":"private"}]},
{"label":"Mascota","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"fechaNacimiento","datatype":"Date","scope":"private"},{"name":"peso","datatype":"Float","scope":"private"}]},
{"label":"Especie","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"descripcion","datatype":"String","scope":"private"}]},
{"label":"Veterinario","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"especialidad","datatype":"String","scope":"private"},{"name":"matricula","datatype":"String","scope":"private"}]},
{"label":"Consulta","asociativa":false,"attributes":[{"name":"fecha","datatype":"Date","scope":"private"},{"name":"motivo","datatype":"String","scope":"private"},{"name":"observaciones","datatype":"String","scope":"private"}]},
{"label":"Diagnostico","asociativa":false,"attributes":[{"name":"descripcion","datatype":"String","scope":"private"},{"name":"gravedad","datatype":"String","scope":"private"}]},
{"label":"Medicamento","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"precio","datatype":"Float","scope":"private"},{"name":"stock","datatype":"Integer","scope":"private"}]},
{"label":"Vacuna","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"lote","datatype":"String","scope":"private"}]},
{"label":"Factura","asociativa":false,"attributes":[{"name":"fecha","datatype":"Date","scope":"private"},{"name":"total","datatype":"Float","scope":"private"},{"name":"pagada","datatype":"Boolean","scope":"private"}]},
{"label":"Receta","asociativa":true,"relaciona":["Consulta","Medicamento"],"attributes":[{"name":"dosis","datatype":"String","scope":"private"},{"name":"dias","datatype":"Integer","scope":"private"}]},
{"label":"AplicacionVacuna","asociativa":true,"relaciona":["Mascota","Vacuna"],"attributes":[{"name":"fecha","datatype":"Date","scope":"private"}]}
]}

EJEMPLO B
Peticion: "crea la base de datos de una cafeteria tipo Starbucks"
Respuesta:
{"classes":[
{"label":"Tienda","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"direccion","datatype":"String","scope":"private"},{"name":"telefono","datatype":"String","scope":"private"}]},
{"label":"Empleado","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"cargo","datatype":"String","scope":"private"},{"name":"fechaIngreso","datatype":"Date","scope":"private"}]},
{"label":"Cliente","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"correo","datatype":"String","scope":"private"},{"name":"telefono","datatype":"String","scope":"private"}]},
{"label":"TarjetaFidelidad","asociativa":false,"attributes":[{"name":"codigo","datatype":"String","scope":"private"},{"name":"puntos","datatype":"Integer","scope":"private"},{"name":"fechaEmision","datatype":"Date","scope":"private"}]},
{"label":"Categoria","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"descripcion","datatype":"String","scope":"private"}]},
{"label":"Producto","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"precio","datatype":"Float","scope":"private"},{"name":"tamano","datatype":"String","scope":"private"}]},
{"label":"Ingrediente","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"stock","datatype":"Float","scope":"private"},{"name":"unidad","datatype":"String","scope":"private"}]},
{"label":"Proveedor","asociativa":false,"attributes":[{"name":"nombre","datatype":"String","scope":"private"},{"name":"contacto","datatype":"String","scope":"private"}]},
{"label":"Pedido","asociativa":false,"attributes":[{"name":"fecha","datatype":"Date","scope":"private"},{"name":"estado","datatype":"String","scope":"private"},{"name":"total","datatype":"Float","scope":"private"}]},
{"label":"Pago","asociativa":false,"attributes":[{"name":"metodo","datatype":"String","scope":"private"},{"name":"monto","datatype":"Float","scope":"private"},{"name":"fecha","datatype":"Date","scope":"private"}]},
{"label":"DetallePedido","asociativa":true,"relaciona":["Pedido","Producto"],"attributes":[{"name":"cantidad","datatype":"Integer","scope":"private"},{"name":"precioUnitario","datatype":"Float","scope":"private"}]},
{"label":"Receta","asociativa":true,"relaciona":["Producto","Ingrediente"],"attributes":[{"name":"cantidad","datatype":"Float","scope":"private"}]}
]}`;

export function umlDomainClassesUser(
  prompt: string,
  existentes: string[],
  minimo: number
): string {
  return [
    EJEMPLOS_CLASES,
    '',
    existentes.length > 0
      ? `CLASES QUE YA EXISTEN EN EL DIAGRAMA (no las repitas): ${existentes.join(', ')}`
      : 'EL DIAGRAMA ESTA VACIO: tenes que crear todo desde cero.',
    '',
    `PETICION DEL USUARIO: ${prompt}`,
    '',
    `Devolve AL MENOS ${minimo} clases, con la escala y el detalle de los ejemplos. Solo clases y atributos: las relaciones van en el paso siguiente.`,
  ].join('\n');
}

/** Segunda pasada de la etapa 1 cuando el modelo devolvio menos clases que el minimo. */
export function umlDomainFaltantesUser(
  prompt: string,
  yaCreadas: string[],
  faltan: number
): string {
  return [
    `PETICION ORIGINAL DEL USUARIO: ${prompt}`,
    '',
    `Ya tenemos estas clases: ${yaCreadas.join(', ')}`,
    '',
    `Faltan ${faltan} clases para completar el modelo. Devolve UNICAMENTE las ${faltan} clases que FALTAN, ` +
      'con sus atributos y en el mismo formato {"classes":[...]}. No repitas ninguna de las que ya tenemos. ' +
      'Pensa en lo que todavia no esta cubierto del negocio.',
  ].join('\n');
}

// ---------------------------------------------------------------- etapa 2

export const UML_DOMAIN_RELATIONS_SYSTEM = `Eres un analista de sistemas. Recibes la lista CERRADA de clases de un diagrama de clases UML 2.5 y devuelves las relaciones entre ellas.

Devuelves UNICAMENTE un objeto JSON con esta forma, sin markdown y sin explicaciones:
{"relations":[{"sourceLabel":"A","targetLabel":"B","tipo":"asociacion","multiplicidadOrigen":"1","multiplicidadDestino":"*"}]}

Valores permitidos, no inventes otros:
- tipo: asociacion, agregacion, composicion, herencia, dependencia
- multiplicidad: "1" o "*"

REGLAS, son obligatorias:
1. Usa UNICAMENTE nombres de clase de la lista que se te entrega. Una relacion con una clase que no este en la lista se descarta.
2. TODA clase de la lista tiene que aparecer en al menos una relacion. Una clase suelta es un error.
3. Ninguna relacion "*" a "*": eso ya lo resuelven las clases asociativas de la lista.
4. Para una clase asociativa, devolve sus DOS relaciones: desde cada una de las clases que une hacia ella, con multiplicidad "1" del lado de la clase y "*" del lado de la asociativa.
5. Composicion cuando la parte no existe sin el todo; agregacion cuando si existe por separado; herencia solo si hay una especializacion real, y en ese caso con multiplicidades "1" y "1".
6. Una clase no se relaciona consigo misma.`;

export function umlDomainRelationsUser(
  prompt: string,
  clases: Array<{ label: string; asociativa: boolean; relaciona?: string[] }>
): string {
  const normales = clases.filter(c => !c.asociativa).map(c => c.label);
  const asociativas = clases.filter(c => c.asociativa);
  return [
    `EJEMPLO
Clases normales: Cliente, Mascota, Veterinario, Consulta
Clases asociativas: Receta (une Consulta y Medicamento)
Respuesta:
{"relations":[
{"sourceLabel":"Cliente","targetLabel":"Mascota","tipo":"asociacion","multiplicidadOrigen":"1","multiplicidadDestino":"*"},
{"sourceLabel":"Mascota","targetLabel":"Consulta","tipo":"asociacion","multiplicidadOrigen":"1","multiplicidadDestino":"*"},
{"sourceLabel":"Veterinario","targetLabel":"Consulta","tipo":"asociacion","multiplicidadOrigen":"1","multiplicidadDestino":"*"},
{"sourceLabel":"Consulta","targetLabel":"Receta","tipo":"asociacion","multiplicidadOrigen":"1","multiplicidadDestino":"*"},
{"sourceLabel":"Medicamento","targetLabel":"Receta","tipo":"asociacion","multiplicidadOrigen":"1","multiplicidadDestino":"*"}
]}`,
    '',
    `NEGOCIO: ${prompt}`,
    '',
    `CLASES NORMALES: ${normales.join(', ')}`,
    asociativas.length > 0
      ? `CLASES ASOCIATIVAS: ${asociativas
          .map(c => `${c.label} (une ${(c.relaciona ?? []).join(' y ')})`)
          .join('; ')}`
      : 'CLASES ASOCIATIVAS: ninguna',
    '',
    'Devolve todas las relaciones. Revisa que ninguna clase quede suelta.',
  ].join('\n');
}

// ---------------------------------------------------------------- deteccion

/**
 * Decide si la instruccion pide modelar un dominio completo o es una edicion
 * puntual. Los descartes van primero porque "agrega un atributo precio a la
 * clase Producto de la tienda" menciona una tienda pero es una instruccion
 * atomica, y contestarla con doce clases seria peor que el bug original.
 */
export function esPeticionDeDominio(prompt: string): boolean {
  const t = prompt.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (/\b(atributo|campo|propiedad)\b/.test(t)) return false;
  if (/\bclase\b/.test(t) && /\bcon\b/.test(t)) return false;
  if (/\b(hereda|extiende|se relaciona|relacion entre|borra|elimina|renombra|cambiale)\b/.test(t)) return false;

  // "al menos 10 tablas", "12 clases": pedir una cantidad ya es pedir un modelo.
  if (/\b\d{1,2}\s*(clases?|tablas?|entidades?)\b/.test(t)) return true;

  const pideModelo =
    /\b(base de datos|bd|modelo|modela|modelar|disena|disenar|diseno|sistema|esquema|dominio|diagrama completo|todo el)\b/.test(t);
  const pideNegocio =
    /\b(para una|para un|de una|de un|tipo)\b/.test(t) ||
    /\b(veterinaria|cafeteria|restaurante|tienda|farmacia|hotel|biblioteca|colegio|universidad|clinica|gimnasio|banco|ecommerce|inventario|ventas|rrhh|hospital)\b/.test(t);

  return pideModelo && pideNegocio;
}

/** Limites del modo dominio. El maximo evita que un "100 tablas" cuelgue la demo. */
export const MIN_CLASES_DOMINIO = 8;
export const MAX_CLASES_DOMINIO = 20;

/**
 * Cuantas clases pidio el usuario explicitamente ("al menos 10 tablas").
 * Devuelve el minimo por defecto cuando no dijo un numero.
 */
export function minimoSolicitado(prompt: string): number {
  const t = prompt.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const m = /\b(\d{1,3})\s*(clases?|tablas?|entidades?)\b/.exec(t);
  if (!m) return MIN_CLASES_DOMINIO;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return MIN_CLASES_DOMINIO;
  return Math.min(Math.max(n, MIN_CLASES_DOMINIO), MAX_CLASES_DOMINIO);
}
