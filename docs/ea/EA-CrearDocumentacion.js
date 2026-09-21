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

/** Elemento con estereotipo, anidado dentro de otro si se pasa padre. */
function elementoEstereotipado(pkg, nombre, tipo, estereotipo, padre, color) {
  var el = elemento(pkg, nombre, tipo);
  if (estereotipo != "") el.Stereotype = estereotipo;
  // ParentID es lo que hace que EA lo dibuje ADENTRO del otro.
  if (padre != null) el.ParentID = padre.ElementID;
  if (color > 0) el.Backcolor = color;
  el.Author = AUTOR;
  el.Update();
  return el;
}

/** Conector con nombre visible, que en despliegue se usa para el protocolo. */
function conectarConNombre(a, b, tipo, nombre) {
  var c = conectar(a, b, tipo, "", "", 0, nombre);
  if (c != null && nombre != "") { c.Name = nombre; c.Update(); }
  return c;
}

/** Rectangulo de EA: la Y va negada porque su eje crece hacia arriba. */
function rect(x, y, ancho, alto) {
  return "l=" + x + ";r=" + (x + ancho) + ";t=-" + y + ";b=-" + (y + alto) + ";";
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

var SISTEMA = "Herramienta CASE Colaborativa";
var ACTOR = "Modelador participante";

var CASOS = [
  {codigo:"CU01",nombre:"Crear pizarra colaborativa",entidad:"Pizarra",actor:"Modelador anfitrion",seq:true,din:false},
  {codigo:"CU02",nombre:"Compartir enlace de invitacion",entidad:"Pizarra",actor:"Modelador anfitrion",seq:false,din:false},
  {codigo:"CU03",nombre:"Unirse a una pizarra existente",entidad:"Participante",actor:"Modelador participante",seq:true,din:false},
  {codigo:"CU04",nombre:"Administrar pizarras",entidad:"Pizarra",actor:"Modelador anfitrion",seq:false,din:false},
  {codigo:"CU05",nombre:"Crear y editar clases con sus atributos",entidad:"ClaseUml",actor:"Modelador participante",seq:true,din:false},
  {codigo:"CU06",nombre:"Crear relaciones entre clases",entidad:"RelacionUml",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU07",nombre:"Crear relacion muchos a muchos con clase asociativa",entidad:"RelacionUml",actor:"Modelador participante",seq:true,din:false},
  {codigo:"CU08",nombre:"Editar el diagrama mediante instruccion escrita",entidad:"ClaseUml",actor:"Modelador participante",seq:false,din:true},
  {codigo:"CU09",nombre:"Editar el diagrama mediante instruccion por voz",entidad:"ClaseUml",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU10",nombre:"Operar el sistema por voz desde el telefono",entidad:"ClaseUml",actor:"Modelador participante",seq:true,din:false},
  {codigo:"CU11",nombre:"Importar un diagrama desde una fotografia o boceto",entidad:"ImagenSubida",actor:"Modelador participante",seq:true,din:false},
  {codigo:"CU12",nombre:"Importar un diagrama desde archivo",entidad:"Diagrama",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU13",nombre:"Exportar el diagrama a otra herramienta CASE",entidad:"Diagrama",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU14",nombre:"Visualizar los participantes conectados y su actividad",entidad:"Participante",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU15",nombre:"Trabajar sin conexion y sincronizar al reconectar",entidad:"Operacion",actor:"Modelador participante",seq:true,din:true},
  {codigo:"CU16",nombre:"Consultar la bitacora de operaciones del diagrama",entidad:"Operacion",actor:"Modelador anfitrion",seq:false,din:false},
  {codigo:"CU17",nombre:"Generar el modelo conceptual de datos",entidad:"ClaseUml",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU18",nombre:"Generar el mapeo objeto-relacional y el esquema logico",entidad:"RelacionUml",actor:"Modelador participante",seq:true,din:false},
  {codigo:"CU19",nombre:"Analizar la normalizacion del esquema",entidad:"RelacionUml",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU20",nombre:"Generar el DDL de la base de datos",entidad:"Diagrama",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU21",nombre:"Generar el backend en Spring Boot",entidad:"Diagrama",actor:"Modelador participante",seq:true,din:false},
  {codigo:"CU22",nombre:"Generar la coleccion de pruebas para Postman",entidad:"Diagrama",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU23",nombre:"Generar el frontend de prueba",entidad:"Diagrama",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU24",nombre:"Consultar la guia de usuario",entidad:"Diagrama",actor:"Modelador participante",seq:false,din:false},
  {codigo:"CU25",nombre:"Consultar el diagnostico del sistema y el estado de la IA",entidad:"Diagrama",actor:"Modelador anfitrion",seq:false,din:false}
];

var HERENCIA_ACTORES = [
  {hijo:"Modelador anfitrion",padre:"Modelador participante"}
];

var CICLOS = [
  {nombre:"Ciclo 1 - Elaboracion: arquitectura colaborativa",casos:["CU01","CU02","CU03","CU04","CU05","CU06","CU07","CU14","CU15","CU16"]},
  {nombre:"Ciclo 2 - Construccion: interfaz asistida por IA",casos:["CU08","CU09","CU10","CU11","CU24","CU25"]},
  {nombre:"Ciclo 3 - Construccion: diseno de datos y generacion",casos:["CU12","CU13","CU17","CU18","CU19","CU20","CU21","CU22","CU23"]}
];

var MODULOS = [
  {nombre:"Colaboracion",clases:["Pizarra","Diagrama","Operacion","Participante"]},
  {nombre:"Modelado UML",clases:["ClaseUml","AtributoUml","RelacionUml"]},
  {nombre:"Inteligencia Artificial",clases:["ImagenSubida"]}
];

var NODOS = [
  {clave:"pc",nombre:"Estacion del Ingeniero",est:"device",color:13825512,x:40,y:60,ancho:300,alto:240,contiene:[{nombre:"Navegador de Escritorio",tipo:"Component"},{nombre:"Editor UML Colaborativo",tipo:"Component"}]},
  {clave:"movil",nombre:"Telefono del Ingeniero",est:"device",color:13825512,x:40,y:360,ancho:300,alto:240,contiene:[{nombre:"PWA Asistente de Voz",tipo:"Component"},{nombre:"Interprete de IA On-Device",tipo:"Component"}]},
  {clave:"app",nombre:"Servidor de Aplicacion",est:"node",color:16639176,x:480,y:60,ancho:320,alto:280,contiene:[{nombre:"API REST (Express)",tipo:"Component"},{nombre:"Servidor WebSocket",tipo:"Component"},{nombre:"Motor de Colaboracion",tipo:"Component"}]},
  {clave:"datos",nombre:"Servidor de Base de Datos",est:"node",color:16110290,x:480,y:400,ancho:320,alto:180,contiene:[{nombre:"PostgreSQL 16",tipo:"Component"}]},
  {clave:"ia",nombre:"Servidor de IA Local",est:"node",color:16771496,x:920,y:60,ancho:300,alto:200,contiene:[{nombre:"Ollama (qwen2.5:7b)",tipo:"Component"}]},
  {clave:"nube",nombre:"Proveedor de IA en la Nube",est:"node",color:14737632,x:920,y:320,ancho:300,alto:180,contiene:[{nombre:"OpenAI (respaldo)",tipo:"Component"}]}
];

var ENLACES = [
  {de:"pc",a:"app",protocolo:"HTTPS / WSS"},
  {de:"movil",a:"app",protocolo:"HTTPS / WSS"},
  {de:"app",a:"datos",protocolo:"TCP 5432"},
  {de:"app",a:"ia",protocolo:"HTTP 11434"},
  {de:"app",a:"nube",protocolo:"HTTPS"}
];

var COMPONENTES = [
  {clave:"ui",nombre:"Editor UML",color:16639176},
  {clave:"colab",nombre:"Colaboracion en Tiempo Real",color:16639176},
  {clave:"voz",nombre:"Asistente por Voz",color:16639176},
  {clave:"vision",nombre:"Reconocimiento de Diagramas",color:16639176},
  {clave:"case",nombre:"Intercambio CASE",color:16639176},
  {clave:"datos",nombre:"Diseno de Datos",color:13825512},
  {clave:"gen",nombre:"Generador Spring Boot",color:13825512},
  {clave:"ia",nombre:"Proveedor de IA",color:16771496},
  {clave:"persist",nombre:"Persistencia de Operaciones",color:16110290}
];

var DEPENDENCIAS = [
  {de:"ui",a:"colab",nombre:"usa"},
  {de:"voz",a:"ia",nombre:"consulta"},
  {de:"vision",a:"ia",nombre:"consulta"},
  {de:"ui",a:"datos",nombre:"usa"},
  {de:"datos",a:"gen",nombre:"alimenta"},
  {de:"case",a:"ui",nombre:"importa en"},
  {de:"colab",a:"persist",nombre:"persiste"},
  {de:"ia",a:"persist",nombre:"audita"}
];

var CAPAS = [
  {nombre:"Capa de Presentacion",color:13825512,modulos:["Editor UML","Asistente por Voz","Guia de Usuario"]},
  {nombre:"Capa de Aplicacion",color:16639176,modulos:["Colaboracion","Intercambio CASE","Generacion de Codigo"]},
  {nombre:"Capa de Dominio",color:16771496,modulos:["Modelo UML","Diseno de Datos"]},
  {nombre:"Capa de Infraestructura",color:16110290,modulos:["PostgreSQL","Ollama / OpenAI","Almacen de Archivos"]}
];

/** Diagrama de despliegue: nodos fisicos, lo que corre en cada uno y los protocolos. */
function despliegue(pkg) {
  var dia = diagrama(pkg, "Diseno Fisico (Modelo de Despliegue)", "Deployment");
  var porClave = {}, i, j;
  for (i = 0; i < NODOS.length; i++) {
    var n = NODOS[i];
    var nodo = elementoEstereotipado(pkg, n.nombre, "Node", n.est, null, n.color);
    enDiagrama(dia, nodo, rect(n.x, n.y, n.ancho, n.alto));
    porClave[n.clave] = nodo;
    for (j = 0; j < n.contiene.length; j++) {
      var c = n.contiene[j];
      var comp = elementoEstereotipado(pkg, c.nombre, c.tipo, "", nodo, 0);
      // Adentro del padre, con margen, para que EA lo dibuje contenido.
      enDiagrama(dia, comp, rect(n.x + 20, n.y + 50 + j * 70, n.ancho - 40, 50));
    }
  }
  for (i = 0; i < ENLACES.length; i++) {
    var e = ENLACES[i];
    conectarConNombre(porClave[e.de], porClave[e.a], "Association", e.protocolo);
  }
  Repository.ReloadDiagram(dia.DiagramID);
  return dia;
}

/** Diagrama de componentes: que hay y quien consume a quien. */
function componentes(pkg) {
  var dia = diagrama(pkg, "Implementacion de la Arquitectura del Sistema", "Component");
  var porClave = {}, i;
  for (i = 0; i < COMPONENTES.length; i++) {
    var c = COMPONENTES[i];
    var el = elementoEstereotipado(pkg, c.nombre, "Component", "", null, c.color);
    var x = 60 + (i % 3) * 320;
    var y = 60 + Math.floor(i / 3) * 160;
    enDiagrama(dia, el, rect(x, y, 260, 90));
    porClave[c.clave] = el;
  }
  // La interfaz publica del backend, que es lo que consume el frontend.
  var api = elementoEstereotipado(pkg, "API REST", "Interface", "interface", null, 0xffe9a8);
  enDiagrama(dia, api, rect(700, 620, 220, 70));
  for (i = 0; i < DEPENDENCIAS.length; i++) {
    var d = DEPENDENCIAS[i];
    conectarConNombre(porClave[d.de], porClave[d.a], "Dependency", d.nombre);
  }
  conectarConNombre(porClave["colab"], api, "Dependency", "expone");
  conectarConNombre(porClave["ui"], api, "Dependency", "consume");
  Repository.ReloadDiagram(dia.DiagramID);
  return dia;
}

/** Diagrama de paquetes en capas, con la dependencia siempre hacia abajo. */
function capas(pkg) {
  var dia = diagrama(pkg, "Diseno Logico (Diagrama en Capas)", "Package");
  var deCapa = [], i, j;
  for (i = 0; i < CAPAS.length; i++) {
    var c = CAPAS[i];
    var y = 60 + i * 200;
    var capa = elementoEstereotipado(pkg, c.nombre, "Package", "layer", null, c.color);
    enDiagrama(dia, capa, rect(40, y, 980, 160));
    var dentro = [];
    for (j = 0; j < c.modulos.length; j++) {
      var m = elementoEstereotipado(pkg, c.modulos[j], "Package", "", capa, 0xfde4c8);
      enDiagrama(dia, m, rect(80 + j * 300, y + 50, 250, 80));
      dentro.push(m);
    }
    deCapa.push(dentro);
  }
  // Cada modulo depende de la capa de abajo: es la regla que el diagrama
  // tiene que dejar ver de un vistazo.
  for (i = 0; i < deCapa.length - 1; i++) {
    for (j = 0; j < deCapa[i].length; j++) {
      var destino = deCapa[i + 1][j % deCapa[i + 1].length];
      conectar(deCapa[i][j], destino, "Dependency", "", "", 0, "");
    }
  }
  Repository.ReloadDiagram(dia.DiagramID);
  return dia;
}

/** Un diagrama de casos de uso: actor, frontera y el caso de uso adentro. */
function diagramaCasoDeUso(pkg, caso) {
  var dia = diagrama(pkg, caso.codigo + ": " + caso.nombre, "Use Case");
  var act = elemento(pkg, caso.actor, "Actor");
  var frontera = elemento(pkg, "Sistema", "Boundary");
  var uc = elemento(pkg, caso.nombre, "UseCase");
  uc.Author = AUTOR; uc.Update();
  enDiagrama(dia, act, "l=40;r=110;t=-120;b=-200;");
  enDiagrama(dia, frontera, "l=200;r=560;t=-40;b=-300;");
  enDiagrama(dia, uc, "l=280;r=480;t=-140;b=-190;");
  conectar(act, uc, "Association", "", "", 0, "");
  Repository.ReloadDiagram(dia.DiagramID);
  return dia;
}

/** Clases dinamicas de un caso de uso: frontera, control y entidad. */
function clasesDinamicas(pkg, caso) {
  var dia = diagrama(pkg, caso.codigo + ": " + caso.nombre, "Logical");
  var corto = caso.nombre.replace(/[^A-Za-z0-9]/g, "");
  var frm = elemento(pkg, "frm" + corto, "Class");
  frm.Stereotype = "boundary"; frm.Author = AUTOR; frm.Update();
  var ctrl = elemento(pkg, "ctrl" + corto, "Class");
  ctrl.Stereotype = "control"; ctrl.Author = AUTOR; ctrl.Update();
  var ent = elemento(pkg, caso.entidad != "" ? caso.entidad : "Entidad" + corto, "Class");
  ent.Stereotype = "entity"; ent.Author = AUTOR; ent.Update();
  enDiagrama(dia, frm, "l=40;r=240;t=-60;b=-150;");
  enDiagrama(dia, ctrl, "l=320;r=520;t=-60;b=-150;");
  enDiagrama(dia, ent, "l=600;r=800;t=-60;b=-150;");
  conectar(frm, ctrl, "Association", "1..1", "1..1", 0, "");
  conectar(ctrl, ent, "Association", "1..1", "0..*", 0, "");
  Repository.ReloadDiagram(dia.DiagramID);
  return dia;
}

/** Diagrama de secuencia de un caso de uso, con sus mensajes numerados. */
function secuencia(pkg, caso, orden) {
  var dia = diagrama(pkg, "sd sc" + orden + ": " + caso.nombre, "Sequence");
  var corto = caso.nombre.replace(/[^A-Za-z0-9]/g, "");
  var lineas = [
    { nombre: caso.actor, tipo: "Actor" },
    { nombre: "frm" + corto, tipo: "Sequence" },
    { nombre: "ctrl" + corto, tipo: "Sequence" },
    { nombre: caso.entidad != "" ? caso.entidad : "Entidad" + corto, tipo: "Sequence" }
  ];
  var els = [], i;
  for (i = 0; i < lineas.length; i++) {
    var el = elemento(pkg, lineas[i].nombre + " (" + caso.codigo + ")", lineas[i].tipo);
    el.Update();
    var l = 60 + i * 220;
    enDiagrama(dia, el, "l=" + l + ";r=" + (l + 120) + ";t=-40;b=-90;");
    els.push(el);
  }
  var mensajes = [
    { de: 0, a: 1, texto: "1: solicita " + caso.nombre },
    { de: 1, a: 2, texto: "2: valida los datos" },
    { de: 2, a: 3, texto: "3: guarda" },
    { de: 3, a: 2, texto: "4: confirma" },
    { de: 2, a: 1, texto: "5: resultado" },
    { de: 1, a: 0, texto: "6: muestra el resultado" }
  ];
  for (i = 0; i < mensajes.length; i++) {
    var m = mensajes[i];
    var c = els[m.de].Connectors.AddNew(m.texto, "Sequence");
    c.SupplierID = els[m.a].ElementID;
    c.Update();
    // SequenceNo fija el orden vertical de los mensajes.
    try { c.SequenceNo = i + 1; c.Update(); } catch (err) { }
    els[m.de].Connectors.Refresh();
  }
  Repository.ReloadDiagram(dia.DiagramID);
  return dia;
}

function main() {
  Repository.EnsureOutputVisible("Script");
  if (Repository.Models.Count == 0) { log("ERROR: abri un proyecto en EA antes de correr el script."); return; }
  var raiz = Repository.Models.GetAt(0);
  log("== Armando la estructura del documento: " + SISTEMA + " ==");

  var sis = paqueteHijo(raiz, SISTEMA);
  var req = paqueteHijo(sis, "1. Requisitos");
  var pkgCu = paqueteHijo(req, "Casos de Uso");
  var pkgGen = paqueteHijo(req, "Diagrama General");
  var ana = paqueteHijo(sis, "2. Analisis");
  var dis = paqueteHijo(sis, "3. Diseno");
  var arq = paqueteHijo(dis, "3.1 Arquitectura Logica");
  var fis = paqueteHijo(arq, "3.1.1 Diseno Fisico");
  var dat = paqueteHijo(dis, "3.2 Modelo de Datos");
  var din = paqueteHijo(dis, "3.4 Clases Dinamicas");
  var sec = paqueteHijo(dis, "3.5 Secuencia");
  var imp = paqueteHijo(sis, "4. Implementacion");

  // ---- 1. Requisitos: un diagrama por caso de uso y el general ----
  var i, j;
  for (i = 0; i < CASOS.length; i++) diagramaCasoDeUso(pkgCu, CASOS[i]);

  var diaGen = diagrama(pkgGen, "uc: Diagrama General de Casos de Uso", "Use Case");
  // Se reusan los elementos del paquete "Casos de Uso": si se crearan otra vez
  // aca, cada caso de uso quedaria duplicado en el modelo y la documentacion
  // generada por EA los listaria dos veces.
  var frontGen = elemento(pkgGen, SISTEMA, "Boundary");
  enDiagrama(diaGen, frontGen, "l=300;r=820;t=-40;b=-" + (120 + CASOS.length * 70) + ";");

  // Cada caso de uso lo dispara SU actor, no un actor generico: el enunciado
  // distingue al anfitrion, al ingeniero de datos, al arquitecto y al de
  // pruebas, y el diagrama general tiene que mostrar esa reparticion.
  var actores = {};
  var cuantosActores = 0;
  for (i = 0; i < CASOS.length; i++) {
    var nom = CASOS[i].actor;
    if (actores[nom] != null) continue;
    var a = existente(pkgCu, nom);
    if (a == null) a = elemento(pkgGen, nom, "Actor");
    var ya = 80 + cuantosActores * 160;
    enDiagrama(diaGen, a, "l=40;r=170;t=-" + ya + ";b=-" + (ya + 90) + ";");
    actores[nom] = a;
    cuantosActores++;
  }

  for (i = 0; i < CASOS.length; i++) {
    var ucG = existente(pkgCu, CASOS[i].nombre);
    if (ucG == null) ucG = elemento(pkgGen, CASOS[i].nombre, "UseCase");
    var t = 100 + i * 70;
    enDiagrama(diaGen, ucG, "l=380;r=760;t=-" + t + ";b=-" + (t + 50) + ";");
    conectar(actores[CASOS[i].actor], ucG, "Association", "", "", 0, "");
  }
  log("Actores distintos en el diagrama general: " + cuantosActores);

  // La generalizacion entre actores: el hijo hereda los casos de uso del padre.
  for (i = 0; i < HERENCIA_ACTORES.length; i++) {
    var h = HERENCIA_ACTORES[i];
    var hijo = actores[h.hijo];
    var padre = actores[h.padre];
    if (hijo == null) { hijo = existente(pkgCu, h.hijo); }
    if (padre == null) { padre = existente(pkgCu, h.padre); }
    if (hijo == null || padre == null) continue;
    enDiagrama(diaGen, hijo, "l=40;r=170;t=-80;b=-170;");
    enDiagrama(diaGen, padre, "l=40;r=170;t=-240;b=-330;");
    conectar(hijo, padre, "Generalization", "", "", 0, "");
  }
  Repository.ReloadDiagram(diaGen.DiagramID);
  log("1. Requisitos: " + CASOS.length + " casos de uso + el diagrama general");

  // ---- 2. Analisis y 3.1 Arquitectura Logica: un paquete por modulo ----
  for (i = 0; i < MODULOS.length; i++) {
    var m = MODULOS[i];
    var pa = paqueteHijo(ana, m.nombre);
    var da = diagrama(pa, "pkg: Modulo " + m.nombre, "Package");
    var de = diagrama(pa, "Encapsulamiento " + m.nombre, "Use Case");
    var pd = paqueteHijo(arq, m.nombre);
    var dd = diagrama(pd, "pkg " + m.nombre, "Package");
    for (j = 0; j < m.clases.length; j++) {
      var cl = elemento(pa, m.clases[j], "Class");
      cl.Author = AUTOR; cl.Update();
      var l = 40 + (j % 3) * 240;
      var tt = 60 + Math.floor(j / 3) * 140;
      enDiagrama(da, cl, "l=" + l + ";r=" + (l + 200) + ";t=-" + tt + ";b=-" + (tt + 100) + ";");
      enDiagrama(de, cl, "l=" + l + ";r=" + (l + 200) + ";t=-" + tt + ";b=-" + (tt + 100) + ";");
      enDiagrama(dd, cl, "l=" + l + ";r=" + (l + 200) + ";t=-" + tt + ";b=-" + (tt + 100) + ";");
    }
    Repository.ReloadDiagram(da.DiagramID);
    Repository.ReloadDiagram(dd.DiagramID);
  }
  log("2. Analisis y 3.1 Arquitectura: " + MODULOS.length + " modulos");

  // ---- Los tres diagramas de arquitectura ----
  capas(arq);
  despliegue(fis);
  componentes(imp);
  log("Arquitectura: capas, despliegue y componentes");

  // ---- 3.2 Modelo de Datos: el modelo conceptual del lienzo ----
  var diaDatos = diagrama(dat, DIAGRAMA, "Logical");
  var porClave = {};
  for (i = 0; i < CLASES.length; i++) {
    var c = CLASES[i];
    var el = elemento(dat, c.nombre, "Class");
    el.Author = AUTOR;
    if (c.asociativa) el.Stereotype = "associative";
    el.Update();
    for (j = 0; j < c.atributos.length; j++) {
      atributo(el, c.atributos[j].nombre, c.atributos[j].tipo, c.atributos[j].vis);
    }
    enDiagrama(diaDatos, el, c.rect);
    porClave[c.clave] = el;
  }
  var rel = 0;
  for (i = 0; i < CONECTORES.length; i++) {
    var r = CONECTORES[i];
    var a = porClave[r.origen], b = porClave[r.destino];
    if (a == null || b == null) continue;
    if (conectar(a, b, r.tipo, r.cardOrigen, r.cardDestino, r.agg, r.nombre) != null) rel++;
  }
  Repository.ReloadDiagram(diaDatos.DiagramID);
  log("3.2 Modelo de Datos: " + CLASES.length + " clases, " + rel + " relaciones nuevas");

  // ---- 3.4 Clases dinamicas y 3.5 Secuencia, por caso de uso ----
  var nDin = 0, nSeq = 0;
  for (i = 0; i < CASOS.length; i++) {
    if (CASOS[i].din) { clasesDinamicas(din, CASOS[i]); nDin++; }
    if (CASOS[i].seq) { secuencia(sec, CASOS[i], ++nSeq); }
  }
  log("3.4 Clases Dinamicas: " + nDin + " | 3.5 Secuencia: " + nSeq);

  // ---- Casos de uso por iteracion, como los agrupa el documento ----
  for (i = 0; i < CICLOS.length; i++) {
    var ci = CICLOS[i];
    var diaCi = diagrama(pkgGen, ci.nombre, "Use Case");
    var puestos = 0;
    for (j = 0; j < CASOS.length; j++) {
      var dentroDelCiclo = false;
      for (var k = 0; k < ci.casos.length; k++) {
        if (ci.casos[k] == CASOS[j].codigo) dentroDelCiclo = true;
      }
      if (!dentroDelCiclo) continue;
      var ucC = existente(pkgCu, CASOS[j].nombre);
      if (ucC == null) continue;
      var tc = 80 + puestos * 70;
      enDiagrama(diaCi, ucC, "l=300;r=700;t=-" + tc + ";b=-" + (tc + 50) + ";");
      var acC = actores[CASOS[j].actor];
      if (acC != null) enDiagrama(diaCi, acC, "l=40;r=170;t=-80;b=-170;");
      puestos++;
    }
    Repository.ReloadDiagram(diaCi.DiagramID);
  }
  log("Diagramas por iteracion: " + CICLOS.length);

  Repository.RefreshModelView(sis.PackageID);
  Repository.OpenDiagram(diaDatos.DiagramID);
  log("");
  log("Listo. Total de diagramas: " + (CASOS.length + nDin + nSeq + MODULOS.length * 3 + CICLOS.length + 5));
  log("Exporta el documento con Publish > Documentation > Generate Documentation.");
}

main();
