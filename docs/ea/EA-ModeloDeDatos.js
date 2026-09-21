!INC Local Scripts.EAConstants-JScript

/*
 * Generado por la herramienta CASE (Ingenieria de Software 1).
 * Pegar en Enterprise Architect 15: Specialize > Tools > Scripting,
 * nuevo script JScript, pegar, y correr con el boton Run (o F5).
 */

/** Busca un paquete hijo por nombre; si no existe lo crea. Idempotente. */
function paqueteHijo(padre, nombre) {
  var i;
  for (i = 0; i < padre.Packages.Count; i++) {
    if (padre.Packages.GetAt(i).Name == nombre) return padre.Packages.GetAt(i);
  }
  var p = padre.Packages.AddNew(nombre, "Package");
  p.Update();
  padre.Packages.Refresh();
  return p;
}

/** Busca un elemento por nombre dentro de un paquete; si no existe lo crea. */
function elemento(pkg, nombre, tipo) {
  var i;
  for (i = 0; i < pkg.Elements.Count; i++) {
    if (pkg.Elements.GetAt(i).Name == nombre) return pkg.Elements.GetAt(i);
  }
  var e = pkg.Elements.AddNew(nombre, tipo);
  e.Update();
  pkg.Elements.Refresh();
  return e;
}

/** Busca un elemento por nombre SIN crearlo. Devuelve null si no esta. */
function existente(pkg, nombre) {
  var i;
  for (i = 0; i < pkg.Elements.Count; i++) {
    if (pkg.Elements.GetAt(i).Name == nombre) return pkg.Elements.GetAt(i);
  }
  return null;
}

/** Busca un diagrama por nombre; si no existe lo crea. */
function diagrama(pkg, nombre, tipo) {
  var i;
  for (i = 0; i < pkg.Diagrams.Count; i++) {
    if (pkg.Diagrams.GetAt(i).Name == nombre) return pkg.Diagrams.GetAt(i);
  }
  var d = pkg.Diagrams.AddNew(nombre, tipo);
  d.Update();
  pkg.Diagrams.Refresh();
  return d;
}

/** Pone un elemento en un diagrama, si no estaba ya. */
function enDiagrama(dia, el, rect) {
  var i;
  for (i = 0; i < dia.DiagramObjects.Count; i++) {
    if (dia.DiagramObjects.GetAt(i).ElementID == el.ElementID) return;
  }
  var o = dia.DiagramObjects.AddNew(rect, "");
  o.ElementID = el.ElementID;
  o.Update();
  dia.DiagramObjects.Refresh();
}

/** Evita conectores repetidos al correr el script dos veces. */
function yaConectados(a, b, tipo) {
  var i;
  for (i = 0; i < a.Connectors.Count; i++) {
    var c = a.Connectors.GetAt(i);
    if (c.Type == tipo && (c.SupplierID == b.ElementID || c.ClientID == b.ElementID)) return true;
  }
  return false;
}

/** Crea un conector entre dos elementos. Devuelve null si ya existia. */
function conectar(a, b, tipo, cardA, cardB, aggB, nombre) {
  if (yaConectados(a, b, tipo)) return null;
  var c = a.Connectors.AddNew(nombre, tipo);
  c.SupplierID = b.ElementID;
  c.Update();
  if (cardA != "") { c.ClientEnd.Cardinality = cardA; c.ClientEnd.Update(); }
  if (cardB != "" || aggB > 0) {
    if (cardB != "") c.SupplierEnd.Cardinality = cardB;
    // 0 = None, 1 = Shared (agregacion), 2 = Composite (composicion).
    if (aggB > 0) c.SupplierEnd.Aggregation = aggB;
    c.SupplierEnd.Update();
  }
  a.Connectors.Refresh();
  return c;
}

/*
 * Nota sobre las multiplicidades: el modelo de la herramienta guarda solo
 * "1" o "*", asi que las asociaciones comunes se crean como "0..*". Si en EA
 * tenias "1..*", ajustalo ahi: el script no lo puede saber.
 */
function log(m) { Repository.WriteOutput("Script", m, 0); }

/** Agrega un atributo si no estaba. */
function atributo(el, nombre, tipo, vis) {
  var i;
  for (i = 0; i < el.Attributes.Count; i++) {
    if (el.Attributes.GetAt(i).Name == nombre) return;
  }
  var a = el.Attributes.AddNew(nombre, tipo);
  a.Visibility = vis;
  a.Update();
  el.Attributes.Refresh();
}

var PAQUETE = "3.2 Modelo de Datos";
var DIAGRAMA = "Diseno Conceptual";
var AUTOR = "Eduardo Rodriguez";

var CLASES = [
  {clave:"c1",nombre:"Diagrama",asociativa:false,rect:"l=380;r=600;t=-40;b=-190;",atributos:[{nombre:"nombre",tipo:"String",vis:"Private"},{nombre:"documento",tipo:"String",vis:"Private"},{nombre:"secuencia",tipo:"int",vis:"Private"},{nombre:"creadoEn",tipo:"Date",vis:"Private"},{nombre:"actualizadoEn",tipo:"Date",vis:"Private"}]},
  {clave:"c2",nombre:"Pizarra",asociativa:false,rect:"l=40;r=260;t=-40;b=-136;",atributos:[{nombre:"nombre",tipo:"String",vis:"Private"},{nombre:"creadoEn",tipo:"Date",vis:"Private"}]},
  {clave:"c3",nombre:"Operacion",asociativa:false,rect:"l=380;r=600;t=-340;b=-490;",atributos:[{nombre:"identificador",tipo:"String",vis:"Private"},{nombre:"secuencia",tipo:"int",vis:"Private"},{nombre:"tipo",tipo:"String",vis:"Private"},{nombre:"contenido",tipo:"String",vis:"Private"},{nombre:"creadoEn",tipo:"Date",vis:"Private"}]},
  {clave:"c4",nombre:"Participante",asociativa:false,rect:"l=40;r=260;t=-340;b=-472;",atributos:[{nombre:"clienteId",tipo:"String",vis:"Private"},{nombre:"nombre",tipo:"String",vis:"Private"},{nombre:"color",tipo:"String",vis:"Private"},{nombre:"conectado",tipo:"boolean",vis:"Private"}]},
  {clave:"c5",nombre:"ClaseUml",asociativa:false,rect:"l=720;r=940;t=-40;b=-172;",atributos:[{nombre:"nombre",tipo:"String",vis:"Private"},{nombre:"posicionX",tipo:"float",vis:"Private"},{nombre:"posicionY",tipo:"float",vis:"Private"},{nombre:"asociativa",tipo:"boolean",vis:"Private"}]},
  {clave:"c6",nombre:"AtributoUml",asociativa:false,rect:"l=1060;r=1280;t=-40;b=-154;",atributos:[{nombre:"nombre",tipo:"String",vis:"Private"},{nombre:"tipoDato",tipo:"String",vis:"Private"},{nombre:"visibilidad",tipo:"String",vis:"Private"}]},
  {clave:"c7",nombre:"RelacionUml",asociativa:false,rect:"l=720;r=940;t=-340;b=-454;",atributos:[{nombre:"tipo",tipo:"String",vis:"Private"},{nombre:"multiplicidadOrigen",tipo:"String",vis:"Private"},{nombre:"multiplicidadDestino",tipo:"String",vis:"Private"}]},
  {clave:"c8",nombre:"ImagenSubida",asociativa:false,rect:"l=1060;r=1280;t=-340;b=-472;",atributos:[{nombre:"archivo",tipo:"String",vis:"Private"},{nombre:"tipoMime",tipo:"String",vis:"Private"},{nombre:"tamanoBytes",tipo:"int",vis:"Private"},{nombre:"creadoEn",tipo:"Date",vis:"Private"}]}
];

var CONECTORES = [
  {tipo:"Association",origen:"c1",destino:"c2",cardOrigen:"1..1",cardDestino:"0..*",agg:0,nombre:""},
  {tipo:"Aggregation",origen:"c3",destino:"c1",cardOrigen:"1..*",cardDestino:"1..1",agg:2,nombre:""},
  {tipo:"Association",origen:"c4",destino:"c3",cardOrigen:"1..1",cardDestino:"0..*",agg:0,nombre:""},
  {tipo:"Aggregation",origen:"c5",destino:"c1",cardOrigen:"1..*",cardDestino:"1..1",agg:2,nombre:""},
  {tipo:"Aggregation",origen:"c6",destino:"c5",cardOrigen:"1..*",cardDestino:"1..1",agg:2,nombre:""},
  {tipo:"Aggregation",origen:"c7",destino:"c1",cardOrigen:"1..*",cardDestino:"1..1",agg:2,nombre:""},
  {tipo:"Association",origen:"c5",destino:"c7",cardOrigen:"1..1",cardDestino:"0..*",agg:0,nombre:""},
  {tipo:"Aggregation",origen:"c8",destino:"c1",cardOrigen:"0..*",cardDestino:"1..1",agg:1,nombre:""}
];

function main() {
  Repository.EnsureOutputVisible("Script");
  log("== Importando el modelo de la herramienta CASE ==");
  if (Repository.Models.Count == 0) { log("ERROR: abri un proyecto en EA antes de correr el script."); return; }
  var raiz = Repository.Models.GetAt(0);
  var pkg = paqueteHijo(raiz, PAQUETE);
  var dia = diagrama(pkg, DIAGRAMA, "Logical");

  var porClave = {};
  var i, j;
  for (i = 0; i < CLASES.length; i++) {
    var c = CLASES[i];
    var el = elemento(pkg, c.nombre, "Class");
    el.Author = AUTOR;
    // EA no tiene un tipo propio para la clase asociativa: se marca con un
    // estereotipo para que se vea en el diagrama y en la documentacion.
    if (c.asociativa) el.Stereotype = "associative";
    el.Update();
    for (j = 0; j < c.atributos.length; j++) {
      atributo(el, c.atributos[j].nombre, c.atributos[j].tipo, c.atributos[j].vis);
    }
    enDiagrama(dia, el, c.rect);
    porClave[c.clave] = el;
  }
  log("Clases: " + CLASES.length);

  var creados = 0;
  for (i = 0; i < CONECTORES.length; i++) {
    var r = CONECTORES[i];
    var a = porClave[r.origen];
    var b = porClave[r.destino];
    if (a == null || b == null) continue;
    if (conectar(a, b, r.tipo, r.cardOrigen, r.cardDestino, r.agg, r.nombre) != null) creados++;
  }
  log("Relaciones nuevas: " + creados + " de " + CONECTORES.length);

  Repository.RefreshModelView(pkg.PackageID);
  Repository.OpenDiagram(dia.DiagramID);
  Repository.ReloadDiagram(dia.DiagramID);
  log("Listo: mira el paquete \"" + PAQUETE + "\" en el Project Browser.");
}

main();
