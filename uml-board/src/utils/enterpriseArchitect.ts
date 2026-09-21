import { v4 as uuidv4 } from 'uuid';
import type { AttributeType, EdgeType, NodeType } from './umlConstants';

/**
 * INTEROPERABILIDAD CON SPARX ENTERPRISE ARCHITECT 15
 *
 * La herramienta CASE de la materia ("Architech" en el enunciado) es Sparx
 * Enterprise Architect 15.0, que guarda el proyecto en un archivo .eapx: una
 * base de datos Access con el esquema propio de EA (t_object, t_connector,
 * t_attribute, t_diagram, t_diagramobjects...). Escribir ese .eapx desde el
 * navegador no es viable -y tocar a mano la base de un proyecto ajeno es una
 * forma conocida de corromperlo-, asi que el intercambio va por donde EA mismo
 * lo soporta: su motor de automatizacion.
 *
 *   CASE  ->  EA : se genera un JScript que se pega en el Script Editor de EA
 *                  (Specialize > Tools > Scripting). Crea el paquete, las
 *                  clases con sus atributos, los conectores con sus
 *                  multiplicidades y un diagrama de clases con las posiciones
 *                  del lienzo.
 *   EA  ->  CASE : se corre en EA el script de exportacion
 *                  (SCRIPT_EXPORTAR_DESDE_EA), que recorre el paquete y
 *                  escribe un JSON; ese JSON se importa aca.
 *
 * Las convenciones de abajo no son inventadas: salen de leer un .eapx real
 * hecho con EA 15 (t_connector / t_attribute), y estan anotadas donde importa.
 */

export interface DiagramaPlano {
  nodes: NodeType[];
  edges: EdgeType[];
}

/**
 * Tipos de dato. EA genera codigo Java en estos proyectos (t_object.GenType =
 * "Java"), y el .eapx de referencia guarda los atributos con los tipos del
 * lenguaje, no con los nombres UML.
 */
const EA_TIPO: Record<AttributeType['datatype'], string> = {
  String: 'String',
  Integer: 'int',
  Float: 'float',
  Boolean: 'boolean',
  Date: 'Date',
};

const EA_TIPO_INVERSO: Record<string, AttributeType['datatype']> = {
  string: 'String',
  String: 'String',
  varchar: 'String',
  text: 'String',
  char: 'String',
  int: 'Integer',
  integer: 'Integer',
  long: 'Integer',
  short: 'Integer',
  Integer: 'Integer',
  float: 'Float',
  double: 'Float',
  decimal: 'Float',
  numeric: 'Float',
  real: 'Float',
  Float: 'Float',
  boolean: 'Boolean',
  bool: 'Boolean',
  bit: 'Boolean',
  Boolean: 'Boolean',
  Date: 'Date',
  date: 'Date',
  datetime: 'Date',
  timestamp: 'Date',
};

/**
 * EA escribe las multiplicidades con rango: "1..1", "0..*".
 *
 * El modelo propio solo guarda "1" o "*", asi que el limite inferior de una
 * asociacion comun no se conoce y se emite el mas permisivo, "0..*": un
 * "1..*" que venga de EA vuelve como "0..*". Es la unica perdida del ciclo de
 * ida y vuelta y esta anotada tambien en el script generado, para que no
 * sorprenda.
 */
const cardEa = (m: '1' | '*'): string => (m === '*' ? '0..*' : '1..1');

/**
 * Multiplicidad del extremo PARTE de una composicion.
 *
 * Aca si se conoce el limite inferior: en una composicion la parte no existe
 * sin el todo, asi que el minimo es 1 y corresponde "1..*", no "0..*". Ademas
 * de ser el UML correcto, hace que el ciclo EA -> CASE -> EA devuelva la misma
 * cardinalidad con la que EA la tenia.
 */
const cardParteEa = (m: '1' | '*'): string => (m === '*' ? '1..*' : '1..1');

const cardDesdeEa = (c: string | undefined): '1' | '*' => {
  const s = String(c ?? '').trim();
  if (s === '') return '1';
  // "0..*", "1..*", "*", "n", "0..n" son todos "muchos" para el modelo.
  return /\*|\bn\b/i.test(s) ? '*' : '1';
};

const VISIBILIDAD_EA: Record<AttributeType['scope'], string> = {
  public: 'Public',
  private: 'Private',
  protected: 'Protected',
};

const visibilidadDesdeEa = (v: string | undefined): AttributeType['scope'] => {
  const s = String(v ?? '').toLowerCase();
  if (s.startsWith('pub') || s === '+') return 'public';
  if (s.startsWith('prot') || s === '#') return 'protected';
  return 'private';
};

/** Escapa un texto para meterlo en un literal de cadena de JScript. */
const jsStr = (texto: string): string =>
  `"${String(texto)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')}"`;

/**
 * Rectangulo de un elemento en un diagrama de EA.
 *
 * En EA el eje Y crece hacia ARRIBA: en t_diagramobjects de un archivo real,
 * un elemento en la parte de arriba del diagrama tiene RectTop = -20 y
 * RectBottom = -340. Por eso las coordenadas del lienzo (Y hacia abajo) se
 * emiten negadas; si no, el diagrama sale espejado en vertical.
 */
function rectEa(x: number, y: number, ancho: number, alto: number): string {
  const l = Math.round(x);
  const t = -Math.round(y);
  return `l=${l};r=${l + ancho};t=${t};b=${t - alto};`;
}

// --------------------------------------------------------------- EA <- CASE

export interface OpcionesEa {
  /** Nombre del paquete que se crea (o se reutiliza) bajo la raiz del modelo. */
  paquete?: string;
  /** Nombre del diagrama de clases. */
  diagrama?: string;
  /** Autor que queda en las propiedades de los elementos. */
  autor?: string;
}

/** Un conector ya traducido a la forma en que EA lo guarda. */
interface ConectorEa {
  tipo: 'Association' | 'Aggregation' | 'Generalization' | 'Dependency';
  /** Clave del elemento que en EA es el Client (Start_Object_ID). */
  origen: string;
  /** Clave del elemento que en EA es el Supplier (End_Object_ID). */
  destino: string;
  cardOrigen: string;
  cardDestino: string;
  /** 0 = ninguna, 1 = compartida (agregacion), 2 = compuesta (composicion). */
  agregacionDestino: 0 | 1 | 2;
  nombre: string;
}

/**
 * Traduce una relacion del modelo propio a la forma de EA.
 *
 * El detalle que importa: en este proyecto una composicion va del TODO (source)
 * a la PARTE (target) -dataDesign marca como entidad debil al target-, mientras
 * que EA la guarda al reves: el conector arranca en la parte y el rombo queda
 * en el extremo Supplier, que es el todo. Se ve tal cual en el .eapx de
 * referencia: DetalleRutina -> Rutina con DestIsAggregate = 2 y las
 * cardinalidades 1..* del lado de la parte y 1..1 del lado del todo. Si no se
 * invierte, EA dibuja el rombo en la clase equivocada.
 */
function aConectorEa(e: EdgeType): ConectorEa {
  if (e.tipo === 'composicion' || e.tipo === 'agregacion') {
    return {
      tipo: 'Aggregation',
      origen: e.target,
      destino: e.source,
      // El origen en EA es la parte; el destino, el todo.
      cardOrigen:
        e.tipo === 'composicion'
          ? cardParteEa(e.multiplicidadDestino)
          : cardEa(e.multiplicidadDestino),
      cardDestino: cardEa(e.multiplicidadOrigen),
      agregacionDestino: e.tipo === 'composicion' ? 2 : 1,
      nombre: '',
    };
  }
  if (e.tipo === 'herencia') {
    return {
      tipo: 'Generalization',
      origen: e.source,
      destino: e.target,
      cardOrigen: '',
      cardDestino: '',
      agregacionDestino: 0,
      nombre: '',
    };
  }
  if (e.tipo === 'dependencia') {
    return {
      tipo: 'Dependency',
      origen: e.source,
      destino: e.target,
      cardOrigen: '',
      cardDestino: '',
      agregacionDestino: 0,
      nombre: '',
    };
  }
  return {
    tipo: 'Association',
    origen: e.source,
    destino: e.target,
    cardOrigen: cardEa(e.multiplicidadOrigen),
    cardDestino: cardEa(e.multiplicidadDestino),
    agregacionDestino: 0,
    nombre: '',
  };
}

/**
 * Cabecera comun de los scripts. Se escribe en JScript porque es el lenguaje
 * que trae EA 15 por defecto en el Script Editor.
 *
 * Restricciones del motor (JScript 5.8, no es JavaScript moderno):
 *   - no hay let, const, arrow functions, template literals ni for..of;
 *   - NO existe el objeto JSON (por eso el script de exportacion serializa a
 *     mano);
 *   - todas las colecciones de EA se recorren con GetAt(i) y Count.
 * Cualquier cosa que se agregue aca tiene que respetar eso.
 */
const PREAMBULO = [
  '!INC Local Scripts.EAConstants-JScript',
  '',
  '/*',
  ' * Generado por la herramienta CASE (Ingenieria de Software 1).',
  ' * Pegar en Enterprise Architect 15: Specialize > Tools > Scripting,',
  ' * nuevo script JScript, pegar, y correr con el boton Run (o F5).',
  ' */',
  '',
  '/** Busca un paquete hijo por nombre; si no existe lo crea. Idempotente. */',
  'function paqueteHijo(padre, nombre) {',
  '  var i;',
  '  for (i = 0; i < padre.Packages.Count; i++) {',
  '    if (padre.Packages.GetAt(i).Name == nombre) return padre.Packages.GetAt(i);',
  '  }',
  '  var p = padre.Packages.AddNew(nombre, "Package");',
  '  p.Update();',
  '  padre.Packages.Refresh();',
  '  return p;',
  '}',
  '',
  '/** Busca un elemento por nombre dentro de un paquete; si no existe lo crea. */',
  'function elemento(pkg, nombre, tipo) {',
  '  var i;',
  '  for (i = 0; i < pkg.Elements.Count; i++) {',
  '    if (pkg.Elements.GetAt(i).Name == nombre) return pkg.Elements.GetAt(i);',
  '  }',
  '  var e = pkg.Elements.AddNew(nombre, tipo);',
  '  e.Update();',
  '  pkg.Elements.Refresh();',
  '  return e;',
  '}',
  '',
  '/** Busca un elemento por nombre SIN crearlo. Devuelve null si no esta. */',
  'function existente(pkg, nombre) {',
  '  var i;',
  '  for (i = 0; i < pkg.Elements.Count; i++) {',
  '    if (pkg.Elements.GetAt(i).Name == nombre) return pkg.Elements.GetAt(i);',
  '  }',
  '  return null;',
  '}',
  '',
  '/** Busca un diagrama por nombre; si no existe lo crea. */',
  'function diagrama(pkg, nombre, tipo) {',
  '  var i;',
  '  for (i = 0; i < pkg.Diagrams.Count; i++) {',
  '    if (pkg.Diagrams.GetAt(i).Name == nombre) return pkg.Diagrams.GetAt(i);',
  '  }',
  '  var d = pkg.Diagrams.AddNew(nombre, tipo);',
  '  d.Update();',
  '  pkg.Diagrams.Refresh();',
  '  return d;',
  '}',
  '',
  '/** Pone un elemento en un diagrama, si no estaba ya. */',
  'function enDiagrama(dia, el, rect) {',
  '  var i;',
  '  for (i = 0; i < dia.DiagramObjects.Count; i++) {',
  '    if (dia.DiagramObjects.GetAt(i).ElementID == el.ElementID) return;',
  '  }',
  '  var o = dia.DiagramObjects.AddNew(rect, "");',
  '  o.ElementID = el.ElementID;',
  '  o.Update();',
  '  dia.DiagramObjects.Refresh();',
  '}',
  '',
  '/** Evita conectores repetidos al correr el script dos veces. */',
  'function yaConectados(a, b, tipo) {',
  '  var i;',
  '  for (i = 0; i < a.Connectors.Count; i++) {',
  '    var c = a.Connectors.GetAt(i);',
  '    if (c.Type == tipo && (c.SupplierID == b.ElementID || c.ClientID == b.ElementID)) return true;',
  '  }',
  '  return false;',
  '}',
  '',
  '/** Crea un conector entre dos elementos. Devuelve null si ya existia. */',
  'function conectar(a, b, tipo, cardA, cardB, aggB, nombre) {',
  '  if (yaConectados(a, b, tipo)) return null;',
  '  var c = a.Connectors.AddNew(nombre, tipo);',
  '  c.SupplierID = b.ElementID;',
  '  c.Update();',
  '  if (cardA != "") { c.ClientEnd.Cardinality = cardA; c.ClientEnd.Update(); }',
  '  if (cardB != "" || aggB > 0) {',
  '    if (cardB != "") c.SupplierEnd.Cardinality = cardB;',
  '    // 0 = None, 1 = Shared (agregacion), 2 = Composite (composicion).',
  '    if (aggB > 0) c.SupplierEnd.Aggregation = aggB;',
  '    c.SupplierEnd.Update();',
  '  }',
  '  a.Connectors.Refresh();',
  '  return c;',
  '}',
  '',
  '/*',
  ' * Nota sobre las multiplicidades: el modelo de la herramienta guarda solo',
  ' * "1" o "*", asi que las asociaciones comunes se crean como "0..*". Si en EA',
  ' * tenias "1..*", ajustalo ahi: el script no lo puede saber.',
  ' */',
  'function log(m) { Repository.WriteOutput("Script", m, 0); }',
  '',
].join('\n');

/** Helper de atributos. Va aparte porque solo lo usan los scripts con clases. */
const HELPER_ATRIBUTOS = [
  '/** Agrega un atributo si no estaba. */',
  'function atributo(el, nombre, tipo, vis) {',
  '  var i;',
  '  for (i = 0; i < el.Attributes.Count; i++) {',
  '    if (el.Attributes.GetAt(i).Name == nombre) return;',
  '  }',
  '  var a = el.Attributes.AddNew(nombre, tipo);',
  '  a.Visibility = vis;',
  '  a.Update();',
  '  el.Attributes.Refresh();',
  '}',
  '',
].join('\n');

/** Serializa los datos del diagrama como literales de JScript. */
function datosJs(d: DiagramaPlano, opts: Required<OpcionesEa>): string {
  const clave = new Map<string, string>();
  d.nodes.forEach((n, i) => clave.set(n.id, `c${i + 1}`));

  const clases = d.nodes.map((n, i) => {
    const alto = 60 + Math.max(1, (n.attributes ?? []).length) * 18;
    const attrs = (n.attributes ?? [])
      .map(
        a =>
          `{nombre:${jsStr(a.name)},tipo:${jsStr(EA_TIPO[a.datatype] ?? 'String')},vis:${jsStr(
            VISIBILIDAD_EA[a.scope] ?? 'Private'
          )}}`
      )
      .join(',');
    return (
      `  {clave:${jsStr(clave.get(n.id) ?? `c${i + 1}`)},nombre:${jsStr(n.label)},` +
      `asociativa:${Boolean(n.asociativa)},rect:${jsStr(rectEa(n.x, n.y, 220, alto))},` +
      `atributos:[${attrs}]}`
    );
  });

  // Solo las relaciones cuyos dos extremos existen: un conector a una clase que
  // no se creo aborta el script en EA con un error de COM poco descifrable.
  const conectores = d.edges
    .map(aConectorEa)
    .filter(c => clave.has(c.origen) && clave.has(c.destino))
    .map(
      c =>
        `  {tipo:${jsStr(c.tipo)},origen:${jsStr(clave.get(c.origen)!)},` +
        `destino:${jsStr(clave.get(c.destino)!)},cardOrigen:${jsStr(c.cardOrigen)},` +
        `cardDestino:${jsStr(c.cardDestino)},agg:${c.agregacionDestino},nombre:${jsStr(c.nombre)}}`
    );

  return [
    `var PAQUETE = ${jsStr(opts.paquete)};`,
    `var DIAGRAMA = ${jsStr(opts.diagrama)};`,
    `var AUTOR = ${jsStr(opts.autor)};`,
    '',
    'var CLASES = [',
    clases.join(',\n'),
    '];',
    '',
    'var CONECTORES = [',
    conectores.join(',\n'),
    '];',
    '',
  ].join('\n');
}

/**
 * Script para EA 15 que reconstruye el diagrama de clases dentro del proyecto
 * abierto. Es idempotente: se puede correr dos veces sin duplicar nada.
 */
export function generarScriptEa(d: DiagramaPlano, opciones: OpcionesEa = {}): string {
  const opts: Required<OpcionesEa> = {
    paquete: opciones.paquete ?? 'Modelo de Datos',
    diagrama: opciones.diagrama ?? 'Diseno Conceptual',
    autor: opciones.autor ?? 'Eduardo Rodriguez',
  };

  const main = [
    'function main() {',
    '  Repository.EnsureOutputVisible("Script");',
    '  log("== Importando el modelo de la herramienta CASE ==");',
    '  if (Repository.Models.Count == 0) { log("ERROR: abri un proyecto en EA antes de correr el script."); return; }',
    '  var raiz = Repository.Models.GetAt(0);',
    '  var pkg = paqueteHijo(raiz, PAQUETE);',
    '  var dia = diagrama(pkg, DIAGRAMA, "Logical");',
    '',
    '  var porClave = {};',
    '  var i, j;',
    '  for (i = 0; i < CLASES.length; i++) {',
    '    var c = CLASES[i];',
    '    var el = elemento(pkg, c.nombre, "Class");',
    '    el.Author = AUTOR;',
    '    // EA no tiene un tipo propio para la clase asociativa: se marca con un',
    '    // estereotipo para que se vea en el diagrama y en la documentacion.',
    '    if (c.asociativa) el.Stereotype = "associative";',
    '    el.Update();',
    '    for (j = 0; j < c.atributos.length; j++) {',
    '      atributo(el, c.atributos[j].nombre, c.atributos[j].tipo, c.atributos[j].vis);',
    '    }',
    '    enDiagrama(dia, el, c.rect);',
    '    porClave[c.clave] = el;',
    '  }',
    '  log("Clases: " + CLASES.length);',
    '',
    '  var creados = 0;',
    '  for (i = 0; i < CONECTORES.length; i++) {',
    '    var r = CONECTORES[i];',
    '    var a = porClave[r.origen];',
    '    var b = porClave[r.destino];',
    '    if (a == null || b == null) continue;',
    '    if (conectar(a, b, r.tipo, r.cardOrigen, r.cardDestino, r.agg, r.nombre) != null) creados++;',
    '  }',
    '  log("Relaciones nuevas: " + creados + " de " + CONECTORES.length);',
    '',
    '  Repository.RefreshModelView(pkg.PackageID);',
    '  Repository.OpenDiagram(dia.DiagramID);',
    '  Repository.ReloadDiagram(dia.DiagramID);',
    '  log("Listo: mira el paquete \\"" + PAQUETE + "\\" en el Project Browser.");',
    '}',
    '',
    'main();',
    '',
  ].join('\n');

  return [PREAMBULO, HELPER_ATRIBUTOS, datosJs(d, opts), main].join('\n');
}

// --------------------------------------------------------------- CASE <- EA

/**
 * Script que se corre EN Enterprise Architect para exportar un paquete a JSON,
 * que despues se importa en la herramienta CASE.
 *
 * Detalle del motor: JScript 5.8 NO tiene el objeto JSON, asi que la
 * serializacion va a mano. Y todo lo que no sea ASCII se escapa como \\uXXXX
 * para poder escribir el archivo en ASCII: si se escribe en Unicode (UTF-16),
 * el navegador lo lee como UTF-8 y los acentos salen como basura.
 */
export const SCRIPT_EXPORTAR_DESDE_EA = [
  '!INC Local Scripts.EAConstants-JScript',
  '',
  '/*',
  ' * EXPORTAR UN PAQUETE DE EA A LA HERRAMIENTA CASE',
  ' *',
  ' * 1. En el Project Browser, seleccionar el paquete a exportar.',
  ' * 2. Specialize > Tools > Scripting, nuevo script JScript, pegar esto y Run.',
  ' * 3. El JSON queda en RUTA (por defecto C:\\Temp\\modelo-ea.json) y tambien',
  ' *    impreso en la ventana de salida, por si se prefiere copiar y pegar.',
  ' * 4. En la herramienta CASE: Intercambio > Importar > Enterprise Architect.',
  ' */',
  '',
  'var RUTA = "C:\\\\Temp\\\\modelo-ea.json";',
  '',
  'function esc(s) {',
  '  var r = "", i, ch, cod;',
  '  s = "" + s;',
  '  for (i = 0; i < s.length; i++) {',
  '    ch = s.charAt(i);',
  '    cod = s.charCodeAt(i);',
  '    if (ch == "\\"") r += "\\\\\\"";',
  '    else if (ch == "\\\\") r += "\\\\\\\\";',
  '    else if (cod == 10) r += "\\\\n";',
  '    else if (cod == 13) r += "\\\\r";',
  '    else if (cod == 9) r += "\\\\t";',
  '    else if (cod < 32 || cod > 126) {',
  '      var h = cod.toString(16);',
  '      while (h.length < 4) h = "0" + h;',
  '      r += "\\\\u" + h;',
  '    } else r += ch;',
  '  }',
  '  return "\\"" + r + "\\"";',
  '}',
  '',
  'function log(m) { Repository.WriteOutput("Script", m, 0); }',
  '',
  '/** Posiciones de los elementos, tomadas del primer diagrama de clases del paquete. */',
  'function posiciones(pkg) {',
  '  var mapa = {}, i, j;',
  '  for (i = 0; i < pkg.Diagrams.Count; i++) {',
  '    var dia = pkg.Diagrams.GetAt(i);',
  '    for (j = 0; j < dia.DiagramObjects.Count; j++) {',
  '      var o = dia.DiagramObjects.GetAt(j);',
  '      if (mapa["e" + o.ElementID] == null) {',
  '        // En EA el eje Y crece hacia arriba y RectTop es negativo.',
  '        mapa["e" + o.ElementID] = { x: o.left, y: -o.top };',
  '      }',
  '    }',
  '  }',
  '  return mapa;',
  '}',
  '',
  'function main() {',
  '  Repository.EnsureOutputVisible("Script");',
  '  var pkg = Repository.GetTreeSelectedPackage();',
  '  if (pkg == null) { log("ERROR: selecciona un paquete en el Project Browser."); return; }',
  '  log("Exportando el paquete: " + pkg.Name);',
  '',
  '  var pos = posiciones(pkg);',
  '  var clases = [], conectores = [], i, j, k;',
  '  var idsDelPaquete = {};',
  '',
  '  for (i = 0; i < pkg.Elements.Count; i++) {',
  '    var el = pkg.Elements.GetAt(i);',
  '    if (el.Type != "Class") continue;',
  '    idsDelPaquete["e" + el.ElementID] = true;',
  '  }',
  '',
  '  for (i = 0; i < pkg.Elements.Count; i++) {',
  '    var el = pkg.Elements.GetAt(i);',
  '    if (el.Type != "Class") continue;',
  '',
  '    var p = pos["e" + el.ElementID];',
  '    var x = p == null ? 40 + (clases.length % 4) * 300 : p.x;',
  '    var y = p == null ? 40 + Math.floor(clases.length / 4) * 240 : p.y;',
  '',
  '    var atts = [];',
  '    for (j = 0; j < el.Attributes.Count; j++) {',
  '      var a = el.Attributes.GetAt(j);',
  '      atts.push("{\\"nombre\\":" + esc(a.Name) + ",\\"tipo\\":" + esc(a.Type) +',
  '                ",\\"visibilidad\\":" + esc(a.Visibility) + "}");',
  '    }',
  '',
  '    clases.push("{\\"id\\":" + esc("" + el.ElementID) + ",\\"guid\\":" + esc(el.ElementGUID) +',
  '                ",\\"nombre\\":" + esc(el.Name) +',
  '                ",\\"estereotipo\\":" + esc(el.Stereotype) +',
  '                ",\\"x\\":" + x + ",\\"y\\":" + y +',
  '                ",\\"atributos\\":[" + atts.join(",") + "]}");',
  '',
  '    for (k = 0; k < el.Connectors.Count; k++) {',
  '      var c = el.Connectors.GetAt(k);',
  '      // Cada conector aparece en los dos extremos: se toma una sola vez,',
  '      // desde el lado del Client.',
  '      if (c.ClientID != el.ElementID) continue;',
  '      if (idsDelPaquete["e" + c.SupplierID] == null) continue;',
  '      conectores.push("{\\"guid\\":" + esc(c.ConnectorGUID) + ",\\"tipo\\":" + esc(c.Type) +',
  '        ",\\"origen\\":" + esc("" + c.ClientID) + ",\\"destino\\":" + esc("" + c.SupplierID) +',
  '        ",\\"cardOrigen\\":" + esc(c.ClientEnd.Cardinality) +',
  '        ",\\"cardDestino\\":" + esc(c.SupplierEnd.Cardinality) +',
  '        ",\\"aggOrigen\\":" + c.ClientEnd.Aggregation +',
  '        ",\\"aggDestino\\":" + c.SupplierEnd.Aggregation + "}");',
  '    }',
  '  }',
  '',
  '  var json = "{\\"herramienta\\":\\"Enterprise Architect\\",\\"paquete\\":" + esc(pkg.Name) +',
  '             ",\\"clases\\":[" + clases.join(",") + "]" +',
  '             ",\\"conectores\\":[" + conectores.join(",") + "]}";',
  '',
  '  try {',
  '    var fso = new ActiveXObject("Scripting.FileSystemObject");',
  '    var carpeta = RUTA.substring(0, RUTA.lastIndexOf("\\\\"));',
  '    if (!fso.FolderExists(carpeta)) fso.CreateFolder(carpeta);',
  '    var f = fso.CreateTextFile(RUTA, true);',
  '    f.Write(json);',
  '    f.Close();',
  '    log("Archivo escrito: " + RUTA);',
  '  } catch (err) {',
  '    log("No se pudo escribir el archivo (" + err.message + "). Copia el JSON de abajo.");',
  '  }',
  '',
  '  log("Clases: " + clases.length + " | Relaciones: " + conectores.length);',
  '  log(json);',
  '}',
  '',
  'main();',
  '',
].join('\n');

interface DumpEa {
  clases?: Array<{
    id?: string;
    guid?: string;
    nombre?: string;
    estereotipo?: string;
    x?: number;
    y?: number;
    atributos?: Array<{ nombre?: string; tipo?: string; visibilidad?: string }>;
  }>;
  conectores?: Array<{
    guid?: string;
    tipo?: string;
    origen?: string;
    destino?: string;
    cardOrigen?: string;
    cardDestino?: string;
    aggOrigen?: number;
    aggDestino?: number;
  }>;
}

/** Lee el JSON que produce SCRIPT_EXPORTAR_DESDE_EA. */
export function importarDumpEa(contenido: string): DiagramaPlano {
  let data: DumpEa;
  try {
    data = JSON.parse(contenido) as DumpEa;
  } catch {
    throw new Error('El archivo no es un JSON valido de Enterprise Architect');
  }
  if (!Array.isArray(data.clases)) {
    throw new Error('El JSON no tiene el arreglo "clases": revisa que sea el que genera el script de EA');
  }

  const porId = new Map<string, string>();
  const nodes: NodeType[] = data.clases.map((c, i) => {
    const id = String(c.guid || c.id || uuidv4());
    if (c.id) porId.set(String(c.id), id);
    if (c.guid) porId.set(String(c.guid), id);
    return {
      id,
      label: String(c.nombre ?? `Clase${i + 1}`),
      x: Number.isFinite(Number(c.x)) ? Number(c.x) : 40 + (i % 4) * 300,
      y: Number.isFinite(Number(c.y)) ? Number(c.y) : 40 + Math.floor(i / 4) * 240,
      attributes: (c.atributos ?? [])
        .filter(a => a && String(a.nombre ?? '').trim() !== '')
        .map(a => ({
          name: String(a.nombre),
          datatype: EA_TIPO_INVERSO[String(a.tipo ?? '')] ?? 'String',
          scope: visibilidadDesdeEa(a.visibilidad),
        })),
      asociativa: /assoc/i.test(String(c.estereotipo ?? '')),
    };
  });

  const edges: EdgeType[] = [];
  for (const c of data.conectores ?? []) {
    const origen = porId.get(String(c.origen));
    const destino = porId.get(String(c.destino));
    // Un conector a un elemento fuera del paquete exportado no se puede dibujar.
    if (!origen || !destino || origen === destino) continue;

    const tipoEa = String(c.tipo ?? 'Association');
    const cardCliente = cardDesdeEa(c.cardOrigen);
    const cardProveedor = cardDesdeEa(c.cardDestino);

    if (tipoEa === 'Generalization') {
      edges.push({
        id: String(c.guid || uuidv4()),
        source: origen,
        target: destino,
        tipo: 'herencia',
        multiplicidadOrigen: '1',
        multiplicidadDestino: '1',
      });
      continue;
    }

    if (tipoEa === 'Dependency' || tipoEa === 'Usage' || tipoEa === 'Realisation') {
      edges.push({
        id: String(c.guid || uuidv4()),
        source: origen,
        target: destino,
        tipo: 'dependencia',
        multiplicidadOrigen: '1',
        multiplicidadDestino: '1',
      });
      continue;
    }

    // Aggregation en EA: el rombo esta en el extremo con Aggregation > 0, que es
    // el TODO. El modelo propio pone el todo en source, asi que se invierte
    // cuando el rombo cae del lado del Supplier. Ver aConectorEa.
    const aggCliente = Number(c.aggOrigen ?? 0);
    const aggProveedor = Number(c.aggDestino ?? 0);
    if (tipoEa === 'Aggregation' || aggCliente > 0 || aggProveedor > 0) {
      const compuesta = Math.max(aggCliente, aggProveedor) === 2;
      const tipo: EdgeType['tipo'] = compuesta ? 'composicion' : 'agregacion';
      if (aggCliente > 0) {
        // El todo ya es el Client: la direccion coincide con la nuestra.
        edges.push({
          id: String(c.guid || uuidv4()),
          source: origen,
          target: destino,
          tipo,
          multiplicidadOrigen: cardCliente,
          multiplicidadDestino: cardProveedor,
        });
      } else {
        edges.push({
          id: String(c.guid || uuidv4()),
          source: destino,
          target: origen,
          tipo,
          multiplicidadOrigen: cardProveedor,
          multiplicidadDestino: cardCliente,
        });
      }
      continue;
    }

    edges.push({
      id: String(c.guid || uuidv4()),
      source: origen,
      target: destino,
      tipo: 'asociacion',
      multiplicidadOrigen: cardCliente,
      multiplicidadDestino: cardProveedor,
    });
  }

  if (nodes.length === 0) throw new Error('El paquete exportado de EA no tiene clases');
  return { nodes, edges };
}

// ------------------------------------------- Estructura completa del documento

export interface CasoDeUsoEa {
  /** "CU01", "CU02"... */
  codigo: string;
  /** "Crear pizarra colaborativa" */
  nombre: string;
  /** Clase del modelo que el caso de uso manipula, para las clases dinamicas. */
  entidad?: string;
  actor?: string;
  /**
   * Los dos flags de abajo existen para que el modelo de EA tenga EXACTAMENTE
   * los diagramas que el documento promete y ni uno mas. El documento detalla
   * diez diagramas de secuencia y dos de clases de analisis, no veinticinco de
   * cada uno: generar de mas deja al modelo diciendo algo distinto del texto,
   * que es el tipo de diferencia que se nota en la defensa.
   */
  conSecuencia?: boolean;
  conClasesDinamicas?: boolean;
}

/** Agrupacion de casos de uso por iteracion, como la presenta el documento. */
export interface CicloEa {
  nombre: string;
  /** Codigos de los casos de uso que entran en la iteracion. */
  casos: string[];
}

export interface ModuloEa {
  nombre: string;
  /** Nombres de clase que agrupa. Si esta vacio, el modulo va sin contenido. */
  clases?: string[];
}

export interface OpcionesDocumentacionEa {
  sistema?: string;
  autor?: string;
  actor?: string;
  casosDeUso?: CasoDeUsoEa[];
  modulos?: ModuloEa[];
  ciclos?: CicloEa[];
  /**
   * Herencia entre actores, como [hijo, padre].
   *
   * Hace falta porque el anfitrion hace todo lo que hace el participante y algo
   * mas. Sin la generalizacion habria que repetir veinte casos de uso en los dos
   * actores, y el diagrama quedaria diciendo que son dos roles con las mismas
   * capacidades, que es justamente lo que no son.
   */
  herenciaActores?: Array<[string, string]>;
  paqueteModelo?: string;
  diagramaModelo?: string;
}

/**
 * Casos de uso por defecto: uno por clase normal del modelo.
 *
 * Las clases asociativas quedan afuera a proposito: DetallePedido no es algo
 * que el usuario "gestione", se llena como parte de gestionar el pedido.
 */
function casosDeUsoPorDefecto(nodes: NodeType[]): CasoDeUsoEa[] {
  return nodes
    .filter(n => !n.asociativa)
    .slice(0, 12)
    .map((n, i) => ({
      codigo: `CU${i + 1}`,
      nombre: `Gestionar ${n.label}`,
      entidad: n.label,
    }));
}

/**
 * Modulos por defecto: se reparten las clases en dos paquetes por orden.
 *
 * Es un punto de partida razonable para el documento, no una verdad del
 * dominio: el arbol queda armado y los nombres se ajustan en EA en un minuto,
 * que es mucho mas rapido que crear veinte paquetes a mano.
 */
function modulosPorDefecto(nodes: NodeType[], sistema: string): ModuloEa[] {
  const nombres = nodes.map(n => n.label);
  if (nombres.length <= 4) return [{ nombre: sistema, clases: nombres }];
  const mitad = Math.ceil(nombres.length / 2);
  return [
    { nombre: 'Catalogo', clases: nombres.slice(0, mitad) },
    { nombre: 'Operacion', clases: nombres.slice(mitad) },
  ];
}

/**
 * Genera el script que arma TODA la estructura del documento en EA 15:
 * el arbol PUDS, los diagramas de casos de uso, el modelo conceptual, las
 * clases dinamicas por caso de uso y los diagramas de secuencia.
 *
 * Replica la organizacion de un proyecto EA real de la materia, para que el
 * documento tenga los mismos capitulos que se piden.
 */
export function generarScriptDocumentacionEa(
  d: DiagramaPlano,
  opciones: OpcionesDocumentacionEa = {}
): string {
  const sistema = opciones.sistema ?? 'Herramienta CASE Colaborativa';
  const autor = opciones.autor ?? 'Eduardo Rodriguez';
  const actor = opciones.actor ?? 'Usuario';
  const cus = opciones.casosDeUso ?? casosDeUsoPorDefecto(d.nodes);
  const modulos = opciones.modulos ?? modulosPorDefecto(d.nodes, sistema);

  const datosModelo = datosJs(d, {
    paquete: opciones.paqueteModelo ?? '3.2 Modelo de Datos',
    diagrama: opciones.diagramaModelo ?? 'Diseno Conceptual',
    autor,
  });

  const datosDoc = [
    `var SISTEMA = ${jsStr(sistema)};`,
    `var ACTOR = ${jsStr(actor)};`,
    '',
    'var CASOS = [',
    cus
      .map(
        c =>
          `  {codigo:${jsStr(c.codigo)},nombre:${jsStr(c.nombre)},` +
          `entidad:${jsStr(c.entidad ?? '')},actor:${jsStr(c.actor ?? actor)},` +
          `seq:${c.conSecuencia !== false},din:${c.conClasesDinamicas !== false}}`
      )
      .join(',\n'),
    '];',
    '',
    'var HERENCIA_ACTORES = [',
    (opciones.herenciaActores ?? [])
      .map(([hijo, padre]) => `  {hijo:${jsStr(hijo)},padre:${jsStr(padre)}}`)
      .join(',\n'),
    '];',
    '',
    'var CICLOS = [',
    (opciones.ciclos ?? [])
      .map(c => `  {nombre:${jsStr(c.nombre)},casos:[${c.casos.map(jsStr).join(',')}]}`)
      .join(',\n'),
    '];',
    '',
    'var MODULOS = [',
    modulos
      .map(
        m =>
          `  {nombre:${jsStr(m.nombre)},clases:[${(m.clases ?? []).map(jsStr).join(',')}]}`
      )
      .join(',\n'),
    '];',
    '',
  ].join('\n');

  const main = [
    '/** Un diagrama de casos de uso: actor, frontera y el caso de uso adentro. */',
    'function diagramaCasoDeUso(pkg, caso) {',
    '  var dia = diagrama(pkg, caso.codigo + ": " + caso.nombre, "Use Case");',
    '  var act = elemento(pkg, caso.actor, "Actor");',
    '  var frontera = elemento(pkg, "Sistema", "Boundary");',
    '  var uc = elemento(pkg, caso.nombre, "UseCase");',
    '  uc.Author = AUTOR; uc.Update();',
    '  enDiagrama(dia, act, "l=40;r=110;t=-120;b=-200;");',
    '  enDiagrama(dia, frontera, "l=200;r=560;t=-40;b=-300;");',
    '  enDiagrama(dia, uc, "l=280;r=480;t=-140;b=-190;");',
    '  conectar(act, uc, "Association", "", "", 0, "");',
    '  Repository.ReloadDiagram(dia.DiagramID);',
    '  return dia;',
    '}',
    '',
    '/** Clases dinamicas de un caso de uso: frontera, control y entidad. */',
    'function clasesDinamicas(pkg, caso) {',
    '  var dia = diagrama(pkg, caso.codigo + ": " + caso.nombre, "Logical");',
    '  var corto = caso.nombre.replace(/[^A-Za-z0-9]/g, "");',
    '  var frm = elemento(pkg, "frm" + corto, "Class");',
    '  frm.Stereotype = "boundary"; frm.Author = AUTOR; frm.Update();',
    '  var ctrl = elemento(pkg, "ctrl" + corto, "Class");',
    '  ctrl.Stereotype = "control"; ctrl.Author = AUTOR; ctrl.Update();',
    '  var ent = elemento(pkg, caso.entidad != "" ? caso.entidad : "Entidad" + corto, "Class");',
    '  ent.Stereotype = "entity"; ent.Author = AUTOR; ent.Update();',
    '  enDiagrama(dia, frm, "l=40;r=240;t=-60;b=-150;");',
    '  enDiagrama(dia, ctrl, "l=320;r=520;t=-60;b=-150;");',
    '  enDiagrama(dia, ent, "l=600;r=800;t=-60;b=-150;");',
    '  conectar(frm, ctrl, "Association", "1..1", "1..1", 0, "");',
    '  conectar(ctrl, ent, "Association", "1..1", "0..*", 0, "");',
    '  Repository.ReloadDiagram(dia.DiagramID);',
    '  return dia;',
    '}',
    '',
    '/** Diagrama de secuencia de un caso de uso, con sus mensajes numerados. */',
    'function secuencia(pkg, caso, orden) {',
    '  var dia = diagrama(pkg, "sd sc" + orden + ": " + caso.nombre, "Sequence");',
    '  var corto = caso.nombre.replace(/[^A-Za-z0-9]/g, "");',
    '  var lineas = [',
    '    { nombre: caso.actor, tipo: "Actor" },',
    '    { nombre: "frm" + corto, tipo: "Sequence" },',
    '    { nombre: "ctrl" + corto, tipo: "Sequence" },',
    '    { nombre: caso.entidad != "" ? caso.entidad : "Entidad" + corto, tipo: "Sequence" }',
    '  ];',
    '  var els = [], i;',
    '  for (i = 0; i < lineas.length; i++) {',
    '    var el = elemento(pkg, lineas[i].nombre + " (" + caso.codigo + ")", lineas[i].tipo);',
    '    el.Update();',
    '    var l = 60 + i * 220;',
    '    enDiagrama(dia, el, "l=" + l + ";r=" + (l + 120) + ";t=-40;b=-90;");',
    '    els.push(el);',
    '  }',
    '  var mensajes = [',
    '    { de: 0, a: 1, texto: "1: solicita " + caso.nombre },',
    '    { de: 1, a: 2, texto: "2: valida los datos" },',
    '    { de: 2, a: 3, texto: "3: guarda" },',
    '    { de: 3, a: 2, texto: "4: confirma" },',
    '    { de: 2, a: 1, texto: "5: resultado" },',
    '    { de: 1, a: 0, texto: "6: muestra el resultado" }',
    '  ];',
    '  for (i = 0; i < mensajes.length; i++) {',
    '    var m = mensajes[i];',
    '    var c = els[m.de].Connectors.AddNew(m.texto, "Sequence");',
    '    c.SupplierID = els[m.a].ElementID;',
    '    c.Update();',
    '    // SequenceNo fija el orden vertical de los mensajes.',
    '    try { c.SequenceNo = i + 1; c.Update(); } catch (err) { }',
    '    els[m.de].Connectors.Refresh();',
    '  }',
    '  Repository.ReloadDiagram(dia.DiagramID);',
    '  return dia;',
    '}',
    '',
    'function main() {',
    '  Repository.EnsureOutputVisible("Script");',
    '  if (Repository.Models.Count == 0) { log("ERROR: abri un proyecto en EA antes de correr el script."); return; }',
    '  var raiz = Repository.Models.GetAt(0);',
    '  log("== Armando la estructura del documento: " + SISTEMA + " ==");',
    '',
    '  var sis = paqueteHijo(raiz, SISTEMA);',
    '  var req = paqueteHijo(sis, "1. Requisitos");',
    '  var pkgCu = paqueteHijo(req, "Casos de Uso");',
    '  var pkgGen = paqueteHijo(req, "Diagrama General");',
    '  var ana = paqueteHijo(sis, "2. Analisis");',
    '  var dis = paqueteHijo(sis, "3. Diseno");',
    '  var arq = paqueteHijo(dis, "3.1 Arquitectura Logica");',
    '  var fis = paqueteHijo(arq, "3.1.1 Diseno Fisico");',
    '  var dat = paqueteHijo(dis, "3.2 Modelo de Datos");',
    '  var din = paqueteHijo(dis, "3.4 Clases Dinamicas");',
    '  var sec = paqueteHijo(dis, "3.5 Secuencia");',
    '  var imp = paqueteHijo(sis, "4. Implementacion");',
    '',
    '  // ---- 1. Requisitos: un diagrama por caso de uso y el general ----',
    '  var i, j;',
    '  for (i = 0; i < CASOS.length; i++) diagramaCasoDeUso(pkgCu, CASOS[i]);',
    '',
    '  var diaGen = diagrama(pkgGen, "uc: Diagrama General de Casos de Uso", "Use Case");',
    '  // Se reusan los elementos del paquete "Casos de Uso": si se crearan otra vez',
    '  // aca, cada caso de uso quedaria duplicado en el modelo y la documentacion',
    '  // generada por EA los listaria dos veces.',
    '  var frontGen = elemento(pkgGen, SISTEMA, "Boundary");',
    '  enDiagrama(diaGen, frontGen, "l=300;r=820;t=-40;b=-" + (120 + CASOS.length * 70) + ";");',
    '',
    '  // Cada caso de uso lo dispara SU actor, no un actor generico: el enunciado',
    '  // distingue al anfitrion, al ingeniero de datos, al arquitecto y al de',
    '  // pruebas, y el diagrama general tiene que mostrar esa reparticion.',
    '  var actores = {};',
    '  var cuantosActores = 0;',
    '  for (i = 0; i < CASOS.length; i++) {',
    '    var nom = CASOS[i].actor;',
    '    if (actores[nom] != null) continue;',
    '    var a = existente(pkgCu, nom);',
    '    if (a == null) a = elemento(pkgGen, nom, "Actor");',
    '    var ya = 80 + cuantosActores * 160;',
    '    enDiagrama(diaGen, a, "l=40;r=170;t=-" + ya + ";b=-" + (ya + 90) + ";");',
    '    actores[nom] = a;',
    '    cuantosActores++;',
    '  }',
    '',
    '  for (i = 0; i < CASOS.length; i++) {',
    '    var ucG = existente(pkgCu, CASOS[i].nombre);',
    '    if (ucG == null) ucG = elemento(pkgGen, CASOS[i].nombre, "UseCase");',
    '    var t = 100 + i * 70;',
    '    enDiagrama(diaGen, ucG, "l=380;r=760;t=-" + t + ";b=-" + (t + 50) + ";");',
    '    conectar(actores[CASOS[i].actor], ucG, "Association", "", "", 0, "");',
    '  }',
    '  log("Actores distintos en el diagrama general: " + cuantosActores);',
    '',
    '  // La generalizacion entre actores: el hijo hereda los casos de uso del padre.',
    '  for (i = 0; i < HERENCIA_ACTORES.length; i++) {',
    '    var h = HERENCIA_ACTORES[i];',
    '    var hijo = actores[h.hijo];',
    '    var padre = actores[h.padre];',
    '    if (hijo == null) { hijo = existente(pkgCu, h.hijo); }',
    '    if (padre == null) { padre = existente(pkgCu, h.padre); }',
    '    if (hijo == null || padre == null) continue;',
    '    enDiagrama(diaGen, hijo, "l=40;r=170;t=-80;b=-170;");',
    '    enDiagrama(diaGen, padre, "l=40;r=170;t=-240;b=-330;");',
    '    conectar(hijo, padre, "Generalization", "", "", 0, "");',
    '  }',
    '  Repository.ReloadDiagram(diaGen.DiagramID);',
    '  log("1. Requisitos: " + CASOS.length + " casos de uso + el diagrama general");',
    '',
    '  // ---- 2. Analisis y 3.1 Arquitectura Logica: un paquete por modulo ----',
    '  for (i = 0; i < MODULOS.length; i++) {',
    '    var m = MODULOS[i];',
    '    var pa = paqueteHijo(ana, m.nombre);',
    '    var da = diagrama(pa, "pkg: Modulo " + m.nombre, "Package");',
    '    var de = diagrama(pa, "Encapsulamiento " + m.nombre, "Use Case");',
    '    var pd = paqueteHijo(arq, m.nombre);',
    '    var dd = diagrama(pd, "pkg " + m.nombre, "Package");',
    '    for (j = 0; j < m.clases.length; j++) {',
    '      var cl = elemento(pa, m.clases[j], "Class");',
    '      cl.Author = AUTOR; cl.Update();',
    '      var l = 40 + (j % 3) * 240;',
    '      var tt = 60 + Math.floor(j / 3) * 140;',
    '      enDiagrama(da, cl, "l=" + l + ";r=" + (l + 200) + ";t=-" + tt + ";b=-" + (tt + 100) + ";");',
    '      enDiagrama(de, cl, "l=" + l + ";r=" + (l + 200) + ";t=-" + tt + ";b=-" + (tt + 100) + ";");',
    '      enDiagrama(dd, cl, "l=" + l + ";r=" + (l + 200) + ";t=-" + tt + ";b=-" + (tt + 100) + ";");',
    '    }',
    '    Repository.ReloadDiagram(da.DiagramID);',
    '    Repository.ReloadDiagram(dd.DiagramID);',
    '  }',
    '  log("2. Analisis y 3.1 Arquitectura: " + MODULOS.length + " modulos");',
    '',
    '  // ---- Los tres diagramas de arquitectura ----',
    '  capas(arq);',
    '  despliegue(fis);',
    '  componentes(imp);',
    '  log("Arquitectura: capas, despliegue y componentes");',
    '',
    '  // ---- 3.2 Modelo de Datos: el modelo conceptual del lienzo ----',
    '  var diaDatos = diagrama(dat, DIAGRAMA, "Logical");',
    '  var porClave = {};',
    '  for (i = 0; i < CLASES.length; i++) {',
    '    var c = CLASES[i];',
    '    var el = elemento(dat, c.nombre, "Class");',
    '    el.Author = AUTOR;',
    '    if (c.asociativa) el.Stereotype = "associative";',
    '    el.Update();',
    '    for (j = 0; j < c.atributos.length; j++) {',
    '      atributo(el, c.atributos[j].nombre, c.atributos[j].tipo, c.atributos[j].vis);',
    '    }',
    '    enDiagrama(diaDatos, el, c.rect);',
    '    porClave[c.clave] = el;',
    '  }',
    '  var rel = 0;',
    '  for (i = 0; i < CONECTORES.length; i++) {',
    '    var r = CONECTORES[i];',
    '    var a = porClave[r.origen], b = porClave[r.destino];',
    '    if (a == null || b == null) continue;',
    '    if (conectar(a, b, r.tipo, r.cardOrigen, r.cardDestino, r.agg, r.nombre) != null) rel++;',
    '  }',
    '  Repository.ReloadDiagram(diaDatos.DiagramID);',
    '  log("3.2 Modelo de Datos: " + CLASES.length + " clases, " + rel + " relaciones nuevas");',
    '',
    '  // ---- 3.4 Clases dinamicas y 3.5 Secuencia, por caso de uso ----',
    '  var nDin = 0, nSeq = 0;',
    '  for (i = 0; i < CASOS.length; i++) {',
    '    if (CASOS[i].din) { clasesDinamicas(din, CASOS[i]); nDin++; }',
    '    if (CASOS[i].seq) { secuencia(sec, CASOS[i], ++nSeq); }',
    '  }',
    '  log("3.4 Clases Dinamicas: " + nDin + " | 3.5 Secuencia: " + nSeq);',
    '',
    '  // ---- Casos de uso por iteracion, como los agrupa el documento ----',
    '  for (i = 0; i < CICLOS.length; i++) {',
    '    var ci = CICLOS[i];',
    '    var diaCi = diagrama(pkgGen, ci.nombre, "Use Case");',
    '    var puestos = 0;',
    '    for (j = 0; j < CASOS.length; j++) {',
    '      var dentroDelCiclo = false;',
    '      for (var k = 0; k < ci.casos.length; k++) {',
    '        if (ci.casos[k] == CASOS[j].codigo) dentroDelCiclo = true;',
    '      }',
    '      if (!dentroDelCiclo) continue;',
    '      var ucC = existente(pkgCu, CASOS[j].nombre);',
    '      if (ucC == null) continue;',
    '      var tc = 80 + puestos * 70;',
    '      enDiagrama(diaCi, ucC, "l=300;r=700;t=-" + tc + ";b=-" + (tc + 50) + ";");',
    '      var acC = actores[CASOS[j].actor];',
    '      if (acC != null) enDiagrama(diaCi, acC, "l=40;r=170;t=-80;b=-170;");',
    '      puestos++;',
    '    }',
    '    Repository.ReloadDiagram(diaCi.DiagramID);',
    '  }',
    '  log("Diagramas por iteracion: " + CICLOS.length);',
    '',
    '  Repository.RefreshModelView(sis.PackageID);',
    '  Repository.OpenDiagram(diaDatos.DiagramID);',
    '  log("");',
    '  log("Listo. Total de diagramas: " + (CASOS.length + nDin + nSeq + MODULOS.length * 3 + CICLOS.length + 5));',
    '  log("Exporta el documento con Publish > Documentation > Generate Documentation.");',
    '}',
    '',
    'main();',
    '',
  ].join('\n');

  return [
    PREAMBULO,
    HELPER_ATRIBUTOS,
    HELPER_ARQUITECTURA,
    datosModelo,
    datosDoc,
    datosArquitecturaJs(),
    FUNCIONES_ARQUITECTURA,
    main,
  ].join('\n');
}

// ------------------------------------------------- EA <- CASE, por XMI 2.1

const escXml = (t: string): string =>
  String(t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * Tipos primitivos como los referencia EA en su XMI. EA resuelve estos idref
 * contra su propio catalogo de tipos de Java; si no los reconoce, el atributo
 * entra sin tipo, que es preferible a que falle la importacion entera.
 */
const XMI_TIPO_EA: Record<AttributeType['datatype'], string> = {
  String: 'EAJava_String',
  Integer: 'EAJava_int',
  Float: 'EAJava_float',
  Boolean: 'EAJava_boolean',
  Date: 'EAJava_Date',
};

/**
 * Exporta en XMI 2.1 con el dialecto de Enterprise Architect, para importarlo
 * con Project > Model Import/Export > Import Package from XMI. Es el camino sin
 * scripts: un archivo que EA abre desde su propio menu.
 *
 * Diferencias con el XMI 2.5 generico de architech.ts, que son justo las que
 * hacen que EA lo acepte:
 *   - namespaces schema.omg.org/spec/... y xmi:version 2.1, no los de 2013;
 *   - las clases van dentro de un packagedElement de tipo uml:Package, no
 *     sueltas en el modelo;
 *   - las asociaciones declaran memberEnd ademas de ownedEnd;
 *   - los tipos se referencian con xmi:idref al catalogo de EA, no con href;
 *   - la generalizacion va dentro de la clase hija.
 *
 * Aviso honesto: esto no se pudo probar contra EA desde el entorno donde se
 * escribio (no hay EA ahi). Si EA se queja del archivo, el camino por script
 * -generarScriptEa- usa la API de automatizacion y no depende de que EA acepte
 * un XMI.
 */
export function exportarXmiEa(d: DiagramaPlano, paquete = 'Modelo de Datos'): string {
  const idClase = new Map<string, string>();
  d.nodes.forEach((n, i) => idClase.set(n.id, `EAID_CL${i + 1}`));

  const l: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmi:XMI xmi:version="2.1" xmlns:uml="http://schema.omg.org/spec/UML/2.1"' +
      ' xmlns:xmi="http://schema.omg.org/spec/XMI/2.1">',
    '\t<xmi:Documentation exporter="Herramienta CASE - Ingenieria de Software 1" exporterVersion="1.0"/>',
    '\t<uml:Model xmi:type="uml:Model" name="EA_Model" visibility="public">',
    `\t\t<packagedElement xmi:type="uml:Package" xmi:id="EAPK_IMPORTADO" name="${escXml(paquete)}" visibility="public">`,
  ];

  for (const n of d.nodes) {
    const id = idClase.get(n.id)!;
    l.push(
      `\t\t\t<packagedElement xmi:type="uml:Class" xmi:id="${id}" name="${escXml(n.label)}" visibility="public">`
    );
    (n.attributes ?? []).forEach((a, j) => {
      l.push(
        `\t\t\t\t<ownedAttribute xmi:type="uml:Property" xmi:id="${id}_AT${j + 1}" name="${escXml(a.name)}" visibility="${a.scope}">`,
        `\t\t\t\t\t<type xmi:idref="${XMI_TIPO_EA[a.datatype] ?? 'EAJava_String'}"/>`,
        '\t\t\t\t</ownedAttribute>'
      );
    });
    // La generalizacion es hija de la clase especializada, no un elemento suelto.
    d.edges
      .filter(e => e.tipo === 'herencia' && e.source === n.id && idClase.has(e.target))
      .forEach((e, k) => {
        l.push(
          `\t\t\t\t<generalization xmi:type="uml:Generalization" xmi:id="${id}_GEN${k + 1}" general="${idClase.get(e.target)}"/>`
        );
      });
    l.push('\t\t\t</packagedElement>');
  }

  d.edges.forEach((e, i) => {
    if (e.tipo === 'herencia') return; // ya emitida dentro de la clase hija
    const src = idClase.get(e.source);
    const dst = idClase.get(e.target);
    if (!src || !dst) return;
    const id = `EAID_RL${i + 1}`;

    if (e.tipo === 'dependencia') {
      l.push(
        `\t\t\t<packagedElement xmi:type="uml:Dependency" xmi:id="${id}" client="${src}" supplier="${dst}" visibility="public"/>`
      );
      return;
    }

    // En UML 2 el rombo va en el extremo del TODO, y aca el todo es source.
    const agregacion =
      e.tipo === 'composicion' ? 'composite' : e.tipo === 'agregacion' ? 'shared' : 'none';
    const limites = (m: '1' | '*', parte: boolean) =>
      m === '*'
        ? [
            `<lowerValue xmi:type="uml:LiteralInteger" value="${parte ? '1' : '0'}"/>`,
            '<upperValue xmi:type="uml:LiteralUnlimitedNatural" value="-1"/>',
          ]
        : [
            '<lowerValue xmi:type="uml:LiteralInteger" value="1"/>',
            '<upperValue xmi:type="uml:LiteralUnlimitedNatural" value="1"/>',
          ];
    // En una composicion la parte no existe sin el todo: el minimo es 1.
    const esComposicion = e.tipo === 'composicion';

    l.push(
      `\t\t\t<packagedElement xmi:type="uml:Association" xmi:id="${id}" visibility="public">`,
      `\t\t\t\t<memberEnd xmi:idref="${id}_SRC"/>`,
      `\t\t\t\t<memberEnd xmi:idref="${id}_DST"/>`,
      `\t\t\t\t<ownedEnd xmi:type="uml:Property" xmi:id="${id}_SRC" visibility="public" association="${id}" aggregation="${agregacion}">`,
      `\t\t\t\t\t<type xmi:idref="${src}"/>`,
      ...limites(e.multiplicidadOrigen, false).map(x => `\t\t\t\t\t${x}`),
      '\t\t\t\t</ownedEnd>',
      `\t\t\t\t<ownedEnd xmi:type="uml:Property" xmi:id="${id}_DST" visibility="public" association="${id}" aggregation="none">`,
      `\t\t\t\t\t<type xmi:idref="${dst}"/>`,
      ...limites(e.multiplicidadDestino, esComposicion).map(x => `\t\t\t\t\t${x}`),
      '\t\t\t\t</ownedEnd>',
      '\t\t\t</packagedElement>'
    );
  });

  l.push('\t\t</packagedElement>', '\t</uml:Model>', '</xmi:XMI>', '');
  return l.join('\n');
}

// --------------------------------- Diagramas de arquitectura del documento

/**
 * Helpers para los diagramas de despliegue, componentes y capas.
 *
 * El anidamiento es lo que les da el aspecto de los diagramas de EA hechos a
 * mano: un componente adentro de un nodo se logra con ParentID -no con una
 * relacion- y ubicando su rectangulo dentro del rectangulo del padre.
 */
const HELPER_ARQUITECTURA = [
  '/** Elemento con estereotipo, anidado dentro de otro si se pasa padre. */',
  'function elementoEstereotipado(pkg, nombre, tipo, estereotipo, padre, color) {',
  '  var el = elemento(pkg, nombre, tipo);',
  '  if (estereotipo != "") el.Stereotype = estereotipo;',
  '  // ParentID es lo que hace que EA lo dibuje ADENTRO del otro.',
  '  if (padre != null) el.ParentID = padre.ElementID;',
  '  if (color > 0) el.Backcolor = color;',
  '  el.Author = AUTOR;',
  '  el.Update();',
  '  return el;',
  '}',
  '',
  '/** Conector con nombre visible, que en despliegue se usa para el protocolo. */',
  'function conectarConNombre(a, b, tipo, nombre) {',
  '  var c = conectar(a, b, tipo, "", "", 0, nombre);',
  '  if (c != null && nombre != "") { c.Name = nombre; c.Update(); }',
  '  return c;',
  '}',
  '',
  '/** Rectangulo de EA: la Y va negada porque su eje crece hacia arriba. */',
  'function rect(x, y, ancho, alto) {',
  '  return "l=" + x + ";r=" + (x + ancho) + ";t=-" + y + ";b=-" + (y + alto) + ";";',
  '}',
  '',
].join('\n');

/**
 * Nodos del diagrama de despliegue. Es la arquitectura real del proyecto, no
 * una plantilla: los puertos y los protocolos son los que usa el sistema.
 */
const NODOS_DESPLIEGUE = [
  {
    clave: 'pc',
    nombre: 'Estacion del Ingeniero',
    estereotipo: 'device',
    color: 0xd2f5e8,
    x: 40,
    y: 60,
    ancho: 300,
    alto: 240,
    contiene: [
      { nombre: 'Navegador de Escritorio', tipo: 'Component' },
      { nombre: 'Editor UML Colaborativo', tipo: 'Component' },
    ],
  },
  {
    clave: 'movil',
    nombre: 'Telefono del Ingeniero',
    estereotipo: 'device',
    color: 0xd2f5e8,
    x: 40,
    y: 360,
    ancho: 300,
    alto: 240,
    contiene: [
      { nombre: 'PWA Asistente de Voz', tipo: 'Component' },
      { nombre: 'Interprete de IA On-Device', tipo: 'Component' },
    ],
  },
  {
    clave: 'app',
    nombre: 'Servidor de Aplicacion',
    estereotipo: 'node',
    color: 0xfde4c8,
    x: 480,
    y: 60,
    ancho: 320,
    alto: 280,
    contiene: [
      { nombre: 'API REST (Express)', tipo: 'Component' },
      { nombre: 'Servidor WebSocket', tipo: 'Component' },
      { nombre: 'Motor de Colaboracion', tipo: 'Component' },
    ],
  },
  {
    clave: 'datos',
    nombre: 'Servidor de Base de Datos',
    estereotipo: 'node',
    color: 0xf5d2d2,
    x: 480,
    y: 400,
    ancho: 320,
    alto: 180,
    contiene: [{ nombre: 'PostgreSQL 16', tipo: 'Component' }],
  },
  {
    clave: 'ia',
    nombre: 'Servidor de IA Local',
    estereotipo: 'node',
    color: 0xffe9a8,
    x: 920,
    y: 60,
    ancho: 300,
    alto: 200,
    contiene: [{ nombre: 'Ollama (qwen2.5:7b)', tipo: 'Component' }],
  },
  {
    clave: 'nube',
    nombre: 'Proveedor de IA en la Nube',
    estereotipo: 'node',
    color: 0xe0e0e0,
    x: 920,
    y: 320,
    ancho: 300,
    alto: 180,
    contiene: [{ nombre: 'OpenAI (respaldo)', tipo: 'Component' }],
  },
];

/** Enlaces del despliegue, con el protocolo como nombre del conector. */
const ENLACES_DESPLIEGUE: Array<[string, string, string]> = [
  ['pc', 'app', 'HTTPS / WSS'],
  ['movil', 'app', 'HTTPS / WSS'],
  ['app', 'datos', 'TCP 5432'],
  ['app', 'ia', 'HTTP 11434'],
  ['app', 'nube', 'HTTPS'],
];

/** Componentes logicos y quien consume a quien. */
const COMPONENTES = [
  { clave: 'ui', nombre: 'Editor UML', color: 0xfde4c8 },
  { clave: 'colab', nombre: 'Colaboracion en Tiempo Real', color: 0xfde4c8 },
  { clave: 'voz', nombre: 'Asistente por Voz', color: 0xfde4c8 },
  { clave: 'vision', nombre: 'Reconocimiento de Diagramas', color: 0xfde4c8 },
  { clave: 'case', nombre: 'Intercambio CASE', color: 0xfde4c8 },
  { clave: 'datos', nombre: 'Diseno de Datos', color: 0xd2f5e8 },
  { clave: 'gen', nombre: 'Generador Spring Boot', color: 0xd2f5e8 },
  { clave: 'ia', nombre: 'Proveedor de IA', color: 0xffe9a8 },
  { clave: 'persist', nombre: 'Persistencia de Operaciones', color: 0xf5d2d2 },
];

const DEPENDENCIAS_COMPONENTES: Array<[string, string, string]> = [
  ['ui', 'colab', 'usa'],
  ['voz', 'ia', 'consulta'],
  ['vision', 'ia', 'consulta'],
  ['ui', 'datos', 'usa'],
  ['datos', 'gen', 'alimenta'],
  ['case', 'ui', 'importa en'],
  ['colab', 'persist', 'persiste'],
  ['ia', 'persist', 'audita'],
];

/** Capas de la arquitectura logica, de arriba hacia abajo. */
const CAPAS = [
  { nombre: 'Capa de Presentacion', color: 0xd2f5e8, modulos: ['Editor UML', 'Asistente por Voz', 'Guia de Usuario'] },
  { nombre: 'Capa de Aplicacion', color: 0xfde4c8, modulos: ['Colaboracion', 'Intercambio CASE', 'Generacion de Codigo'] },
  { nombre: 'Capa de Dominio', color: 0xffe9a8, modulos: ['Modelo UML', 'Diseno de Datos'] },
  { nombre: 'Capa de Infraestructura', color: 0xf5d2d2, modulos: ['PostgreSQL', 'Ollama / OpenAI', 'Almacen de Archivos'] },
];

function datosArquitecturaJs(): string {
  const nodos = NODOS_DESPLIEGUE.map(
    n =>
      `  {clave:${jsStr(n.clave)},nombre:${jsStr(n.nombre)},est:${jsStr(n.estereotipo)},` +
      `color:${n.color},x:${n.x},y:${n.y},ancho:${n.ancho},alto:${n.alto},contiene:[` +
      n.contiene.map(c => `{nombre:${jsStr(c.nombre)},tipo:${jsStr(c.tipo)}}`).join(',') +
      ']}'
  );
  return [
    'var NODOS = [',
    nodos.join(',\n'),
    '];',
    '',
    'var ENLACES = [',
    ENLACES_DESPLIEGUE.map(
      ([a, b, p]) => `  {de:${jsStr(a)},a:${jsStr(b)},protocolo:${jsStr(p)}}`
    ).join(',\n'),
    '];',
    '',
    'var COMPONENTES = [',
    COMPONENTES.map(
      c => `  {clave:${jsStr(c.clave)},nombre:${jsStr(c.nombre)},color:${c.color}}`
    ).join(',\n'),
    '];',
    '',
    'var DEPENDENCIAS = [',
    DEPENDENCIAS_COMPONENTES.map(
      ([a, b, n]) => `  {de:${jsStr(a)},a:${jsStr(b)},nombre:${jsStr(n)}}`
    ).join(',\n'),
    '];',
    '',
    'var CAPAS = [',
    CAPAS.map(
      c =>
        `  {nombre:${jsStr(c.nombre)},color:${c.color},modulos:[${c.modulos.map(jsStr).join(',')}]}`
    ).join(',\n'),
    '];',
    '',
  ].join('\n');
}

/** Cuerpo JScript de los tres diagramas de arquitectura. */
const FUNCIONES_ARQUITECTURA = [
  '/** Diagrama de despliegue: nodos fisicos, lo que corre en cada uno y los protocolos. */',
  'function despliegue(pkg) {',
  '  var dia = diagrama(pkg, "Diseno Fisico (Modelo de Despliegue)", "Deployment");',
  '  var porClave = {}, i, j;',
  '  for (i = 0; i < NODOS.length; i++) {',
  '    var n = NODOS[i];',
  '    var nodo = elementoEstereotipado(pkg, n.nombre, "Node", n.est, null, n.color);',
  '    enDiagrama(dia, nodo, rect(n.x, n.y, n.ancho, n.alto));',
  '    porClave[n.clave] = nodo;',
  '    for (j = 0; j < n.contiene.length; j++) {',
  '      var c = n.contiene[j];',
  '      var comp = elementoEstereotipado(pkg, c.nombre, c.tipo, "", nodo, 0);',
  '      // Adentro del padre, con margen, para que EA lo dibuje contenido.',
  '      enDiagrama(dia, comp, rect(n.x + 20, n.y + 50 + j * 70, n.ancho - 40, 50));',
  '    }',
  '  }',
  '  for (i = 0; i < ENLACES.length; i++) {',
  '    var e = ENLACES[i];',
  '    conectarConNombre(porClave[e.de], porClave[e.a], "Association", e.protocolo);',
  '  }',
  '  Repository.ReloadDiagram(dia.DiagramID);',
  '  return dia;',
  '}',
  '',
  '/** Diagrama de componentes: que hay y quien consume a quien. */',
  'function componentes(pkg) {',
  '  var dia = diagrama(pkg, "Implementacion de la Arquitectura del Sistema", "Component");',
  '  var porClave = {}, i;',
  '  for (i = 0; i < COMPONENTES.length; i++) {',
  '    var c = COMPONENTES[i];',
  '    var el = elementoEstereotipado(pkg, c.nombre, "Component", "", null, c.color);',
  '    var x = 60 + (i % 3) * 320;',
  '    var y = 60 + Math.floor(i / 3) * 160;',
  '    enDiagrama(dia, el, rect(x, y, 260, 90));',
  '    porClave[c.clave] = el;',
  '  }',
  '  // La interfaz publica del backend, que es lo que consume el frontend.',
  '  var api = elementoEstereotipado(pkg, "API REST", "Interface", "interface", null, 0xffe9a8);',
  '  enDiagrama(dia, api, rect(700, 620, 220, 70));',
  '  for (i = 0; i < DEPENDENCIAS.length; i++) {',
  '    var d = DEPENDENCIAS[i];',
  '    conectarConNombre(porClave[d.de], porClave[d.a], "Dependency", d.nombre);',
  '  }',
  '  conectarConNombre(porClave["colab"], api, "Dependency", "expone");',
  '  conectarConNombre(porClave["ui"], api, "Dependency", "consume");',
  '  Repository.ReloadDiagram(dia.DiagramID);',
  '  return dia;',
  '}',
  '',
  '/** Diagrama de paquetes en capas, con la dependencia siempre hacia abajo. */',
  'function capas(pkg) {',
  '  var dia = diagrama(pkg, "Diseno Logico (Diagrama en Capas)", "Package");',
  '  var deCapa = [], i, j;',
  '  for (i = 0; i < CAPAS.length; i++) {',
  '    var c = CAPAS[i];',
  '    var y = 60 + i * 200;',
  '    var capa = elementoEstereotipado(pkg, c.nombre, "Package", "layer", null, c.color);',
  '    enDiagrama(dia, capa, rect(40, y, 980, 160));',
  '    var dentro = [];',
  '    for (j = 0; j < c.modulos.length; j++) {',
  '      var m = elementoEstereotipado(pkg, c.modulos[j], "Package", "", capa, 0xfde4c8);',
  '      enDiagrama(dia, m, rect(80 + j * 300, y + 50, 250, 80));',
  '      dentro.push(m);',
  '    }',
  '    deCapa.push(dentro);',
  '  }',
  '  // Cada modulo depende de la capa de abajo: es la regla que el diagrama',
  '  // tiene que dejar ver de un vistazo.',
  '  for (i = 0; i < deCapa.length - 1; i++) {',
  '    for (j = 0; j < deCapa[i].length; j++) {',
  '      var destino = deCapa[i + 1][j % deCapa[i + 1].length];',
  '      conectar(deCapa[i][j], destino, "Dependency", "", "", 0, "");',
  '    }',
  '  }',
  '  Repository.ReloadDiagram(dia.DiagramID);',
  '  return dia;',
  '}',
  '',
].join('\n');
